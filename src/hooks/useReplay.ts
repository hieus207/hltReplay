'use client';

import { useState, useRef, useCallback } from 'react';
import type { Trade, CandleData, VolumeData, ReplayStatus, OrderPanelHandle } from '@/types';
export type { OrderPanelHandle } from '@/types';
import { lowerBound, upperBound } from '@/lib/bsearch';
import { fmtUTC7 } from '@/lib/format';

export interface ChartMarker {
  timeMs: number;  // UTC ms
  label: string;
  color: string;
  position?: 'aboveBar' | 'belowBar';
}

export interface ChartHandle {
  updateCandle: (c: CandleData) => void;
  updateVolume: (v: VolumeData) => void;
  setData: (candles: CandleData[], volumes: VolumeData[]) => void;
  clear: () => void;
  setPriceDecimals: (decimals: number) => void;
  fitContent: () => void;
  addPriceLine: (id: number, price: number, color: string, title: string) => void;
  removePriceLine: (id: number) => void;
  setMarkers: (markers: ChartMarker[]) => void;
}

export interface OHLCVInfo {
  open: number; high: number; low: number; close: number;
}

interface InternalCandle extends CandleData {
  vol: number;
}

const UTC7_OFFSET_S = 7 * 3600; // seconds

export function useReplay(
  trades: Trade[],
  chartRef: React.RefObject<ChartHandle | null>,
  // DOM refs for high-frequency updates (avoid React re-renders in hot loop)
  domRefs: {
    progFill: React.RefObject<HTMLDivElement | null>;
    progHead: React.RefObject<HTMLDivElement | null>;
    timeDisplay: React.RefObject<HTMLSpanElement | null>;
    ohlcvDisplay: React.RefObject<HTMLDivElement | null>;
    tradeFeed?: React.RefObject<HTMLDivElement | null>;
    orderPanel?: React.RefObject<OrderPanelHandle | null>;
    entryPriceEl?: React.RefObject<HTMLSpanElement | null>;
    decimals?: React.RefObject<number>;
  },
  showToast: (msg: string, type: 'ok' | 'err' | 'info') => void,
) {
  const [status, setStatus] = useState<ReplayStatus>('idle');
  const [speed, setSpeedState] = useState(2);
  const [inRangeCount, setInRangeCount] = useState(0);

  // All hot-loop state lives in refs to avoid stale closures
  const r = useRef({
    paused: true,
    vTime: 0,
    tIdx: 0,
    tIdxStart: 0,
    tIdxEnd: 0,
    startMs: 0,
    endMs: 0,
    intervalMs: 900_000,
    speed: 2,
    lastReal: null as number | null,
    candles: new Map<number, InternalCandle>(),
    lastCt: -Infinity,
    rafId: 0,
    lastFitReal: 0,      // wall-clock ms of last fitContent call
    newCandleCount: 0,   // new candles since last fit
    didInitialFit: false, // fit once when first candles appear, then never auto-fit again
    markers: [] as ChartMarker[],  // sorted by timeMs
    markerIdx: 0,                  // how many have been fired so far
  });

  // Update progress UI without React re-render
  const updateProgress = useCallback((vTime: number, startMs: number, endMs: number) => {
    const pct = Math.min(((vTime - startMs) / (endMs - startMs)) * 100, 100);
    const pctStr = pct + '%';
    if (domRefs.progFill.current) domRefs.progFill.current.style.width = pctStr;
    if (domRefs.progHead.current) domRefs.progHead.current.style.left = pctStr;
    if (domRefs.timeDisplay.current) domRefs.timeDisplay.current.textContent = fmtUTC7(vTime);
  }, [domRefs]);

  const updateOHLCV = useCallback((c: InternalCandle) => {
    const el = domRefs.ohlcvDisplay.current;
    if (!el) return;
    const up = c.close >= c.open;
    const pc = ((c.close - c.open) / c.open) * 100;
    const fmt = (n: number) => n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    el.innerHTML =
      `<span><span class="lbl">O</span>${fmt(c.open)}</span>` +
      `<span><span class="lbl">H</span><span class="${up ? 'h' : 'l'}">${fmt(c.high)}</span></span>` +
      `<span><span class="lbl">L</span><span class="l">${fmt(c.low)}</span></span>` +
      `<span><span class="lbl">C</span><span class="${up ? 'c-up' : 'c-dn'}">${fmt(c.close)}</span></span>` +
      `<span class="${up ? 'c-up' : 'c-dn'}">${pc >= 0 ? '+' : ''}${pc.toFixed(2)}%</span>`;
  }, [domRefs]);

  const tick = useCallback((now: number) => {
    const s = r.current;
    if (s.paused) { s.lastReal = null; return; }

    if (!s.lastReal) s.lastReal = now;
    const elapsed = Math.min(now - s.lastReal, 250); // cap to avoid big jump
    s.lastReal = now;

    const advance = elapsed * s.speed;
    const nextV = s.vTime + advance;
    const updated: number[] = [];
    let processed = 0;
    const MAX = 500_000;

    // Collect trades this frame for feed & order panel notifications
    const feedBatch: Trade[] = [];
    let lastPrice = 0;

    while (s.tIdx < s.tIdxEnd && trades[s.tIdx].time <= nextV && processed < MAX) {
      const tr = trades[s.tIdx];
      feedBatch.push(tr);
      lastPrice = tr.price;
      const ct = Math.floor(tr.time / s.intervalMs) * s.intervalMs;
      let c = s.candles.get(ct);
      if (!c) {
        c = {
          time: ct / 1000 + UTC7_OFFSET_S,
          open: tr.price, high: tr.price, low: tr.price, close: tr.price,
          vol: 0,
        };
        s.candles.set(ct, c);
        updated.push(ct);
        s.newCandleCount++;
      } else {
        if (tr.price > c.high) c.high = tr.price;
        if (tr.price < c.low)  c.low  = tr.price;
        c.close = tr.price;
        if (!updated.includes(ct)) updated.push(ct);
      }
      c.vol += tr.qty;
      s.tIdx++;
      processed++;
    }

    // Push last ≤40 trades to TradeFeed (DOM-direct, capped to avoid thrash)
    const feedEl = domRefs.tradeFeed?.current;
    if (feedEl && feedBatch.length > 0) {
      const dec = domRefs.decimals?.current ?? 5;
      const slice = feedBatch.length > 40 ? feedBatch.slice(-40) : feedBatch;
      let html = '';
      for (let i = slice.length - 1; i >= 0; i--) {
        const t = slice[i];
        const isBuy = t.isBuyerMaker === false;
        const timeStr = fmtUTC7(t.time).slice(-8);
        html +=
          `<div class="tr-row ${isBuy ? 'tr-buy' : 'tr-sell'}">` +
          `<span class="tr-price">${t.price.toFixed(dec)}</span>` +
          `<span class="tr-qty">${t.qty.toFixed(2)}</span>` +
          `<span class="tr-time">${timeStr}</span>` +
          `</div>`;
      }
      feedEl.insertAdjacentHTML('afterbegin', html);
      // Trim to last 200 rows
      while (feedEl.childElementCount > 200) feedEl.removeChild(feedEl.lastChild!);
    }

    // Notify OrderPanel of latest price
    if (lastPrice > 0 && domRefs.orderPanel?.current) {
      domRefs.orderPanel.current.notifyPrice(lastPrice, domRefs.decimals?.current ?? 5, nextV);
    }
    if (lastPrice > 0 && domRefs.entryPriceEl?.current) {
      domRefs.entryPriceEl.current.textContent = lastPrice.toFixed(domRefs.decimals?.current ?? 5);
    }

    // Push to chart in time order
    updated.sort((a, b) => a - b);
    for (const ct of updated) {
      const c = s.candles.get(ct)!;
      if (c.time < s.lastCt) continue;
      try {
        chartRef.current?.updateCandle({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
        chartRef.current?.updateVolume({
          time: c.time, value: c.vol,
          color: c.close >= c.open ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)',
        });
        s.lastCt = c.time;
        updateOHLCV(c);
      } catch (e) { console.warn('[replay] chart update error:', e); }
    }

    // Auto-fit: only fire once at the very start (first batch of candles).
    // After that the user controls zoom manually — don't interrupt.
    if (!s.didInitialFit && s.newCandleCount > 0) {
      chartRef.current?.fitContent();
      s.didInitialFit = true;
      s.newCandleCount = 0;
    }
    s.vTime = processed >= MAX ? (trades[s.tIdx - 1]?.time ?? nextV) : nextV;
    updateProgress(s.vTime, s.startMs, s.endMs);

    // Fire chart markers progressively as replay time crosses each marker timestamp
    while (s.markerIdx < s.markers.length && s.markers[s.markerIdx].timeMs <= s.vTime) {
      s.markerIdx++;
      // Only show markers that fall within the replay range — markers from a
      // different date would otherwise snap to the first/last candle of the chart.
      const fired = s.markers
        .slice(0, s.markerIdx)
        .filter(m => m.timeMs >= s.startMs && m.timeMs <= s.endMs)
        .map(m => ({
          // Snap to candle boundary so lightweight-charts can find the candle
          timeMs: Math.floor(m.timeMs / s.intervalMs) * s.intervalMs,
          label: m.label,
          color: m.color,
          position: m.position,
        }));
      chartRef.current?.setMarkers(fired);
    }

    if (s.tIdx >= s.tIdxEnd || s.vTime >= s.endMs) {
      s.paused = true;
      setStatus('done');
      return;
    }

    s.rafId = requestAnimationFrame(tick);
  }, [trades, chartRef, updateOHLCV, updateProgress]);

  const startReplay = useCallback((startMs: number, endMs: number, intervalMs: number) => {
    if (!trades.length) { showToast('Chưa load data!', 'err'); return; }
    if (startMs >= endMs) { showToast('End phải sau Start!', 'err'); return; }

    const tIdxStart = lowerBound(trades, startMs);
    const tIdxEnd   = upperBound(trades, endMs);
    const cnt = tIdxEnd - tIdxStart;

    if (cnt === 0) {
      // Friendly error with actual trade range info
      const actualStart = fmtUTC7(trades[0].time);
      const actualEnd   = fmtUTC7(trades[trades.length - 1].time);
      showToast(`Không có trade nào trong khoảng này! Dữ liệu từ ${actualStart} → ${actualEnd} (UTC+7)`, 'err');
      return;
    }

    setInRangeCount(cnt);

    // Reset chart
    r.current.candles.clear();
    r.current.lastCt = -Infinity;
    r.current.lastFitReal = 0;
    r.current.newCandleCount = 0;
    r.current.didInitialFit = false;
    r.current.markerIdx = 0;
    chartRef.current?.clear();
    chartRef.current?.setMarkers([]);
    if (domRefs.tradeFeed?.current) domRefs.tradeFeed.current.innerHTML = '';

    // If startMs is before the first actual trade, jump vTime to the first trade
    // to avoid replaying a silent empty gap (could be hours at low speeds).
    const firstTradeMs = trades[tIdxStart]?.time ?? startMs;
    const effectiveStartMs = Math.max(startMs, firstTradeMs);

    const s = r.current;
    s.tIdxStart = tIdxStart;
    s.tIdxEnd   = tIdxEnd;
    s.tIdx      = tIdxStart;
    s.vTime     = effectiveStartMs;
    s.startMs   = effectiveStartMs;
    s.endMs     = endMs;
    s.intervalMs = intervalMs;
    s.paused    = false;
    s.lastReal  = null;

    if (s.rafId) cancelAnimationFrame(s.rafId);
    setStatus('playing');
    showToast(`Replay ${cnt.toLocaleString('en')} trades ▶`, 'ok');
    s.rafId = requestAnimationFrame(tick);
  }, [trades, chartRef, tick, showToast]);

  const togglePlay = useCallback(() => {
    const s = r.current;
    if (status === 'done' || !s.startMs) return;

    s.paused = !s.paused;
    if (s.paused) {
      setStatus('paused');
    } else {
      s.lastReal = null;
      setStatus('playing');
      s.rafId = requestAnimationFrame(tick);
    }
  }, [status, tick]);

  const stopReplay = useCallback(() => {
    const s = r.current;
    if (s.rafId) cancelAnimationFrame(s.rafId);
    s.paused = true;
    s.vTime = 0;
    s.tIdx = 0;
    s.candles.clear();
    s.lastCt = -Infinity;
    chartRef.current?.clear();
    if (domRefs.progFill.current) domRefs.progFill.current.style.width = '0%';
    if (domRefs.progHead.current) domRefs.progHead.current.style.left = '0%';
    if (domRefs.timeDisplay.current) domRefs.timeDisplay.current.textContent = '';
    if (domRefs.tradeFeed?.current) domRefs.tradeFeed.current.innerHTML = '';
    if (domRefs.orderPanel?.current) domRefs.orderPanel.current.reset();
    setStatus('idle');
  }, [chartRef, domRefs]);

  const seek = useCallback((ratio: number) => {
    const s = r.current;
    if (!s.startMs || !trades.length) return;

    const wasPlaying = !s.paused;
    s.paused = true;
    if (s.rafId) cancelAnimationFrame(s.rafId);

    const seekTo = s.startMs + ratio * (s.endMs - s.startMs);

    // Rebuild candles up to seekTo
    const tmpCandles = new Map<number, InternalCandle>();
    let idx = s.tIdxStart;
    while (idx < s.tIdxEnd && trades[idx].time <= seekTo) {
      const tr = trades[idx];
      const ct = Math.floor(tr.time / s.intervalMs) * s.intervalMs;
      let c = tmpCandles.get(ct);
      if (!c) {
        c = { time: ct / 1000 + UTC7_OFFSET_S, open: tr.price, high: tr.price, low: tr.price, close: tr.price, vol: 0 };
        tmpCandles.set(ct, c);
      }
      if (tr.price > c.high) c.high = tr.price;
      if (tr.price < c.low)  c.low  = tr.price;
      c.close = tr.price;
      c.vol += tr.qty;
      idx++;
    }

    const sorted = [...tmpCandles.values()].sort((a, b) => a.time - b.time);
    chartRef.current?.setData(
      sorted,
      sorted.map((c) => ({
        time: c.time, value: c.vol,
        color: c.close >= c.open ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)',
      })),
    );
    s.candles = tmpCandles;
    s.lastCt = sorted.length ? sorted[sorted.length - 1].time : -Infinity;
    if (sorted.length) updateOHLCV(sorted[sorted.length - 1]);

    s.tIdx  = idx;
    s.vTime = seekTo;
    updateProgress(seekTo, s.startMs, s.endMs);

    // Re-fire markers that fall before seekTo; reset count for those still ahead
    const firedCount = s.markers.filter(m => m.timeMs <= seekTo).length;
    s.markerIdx = firedCount;
    if (firedCount > 0) {
      const fired = s.markers.slice(0, firedCount).map(m => ({
        timeMs: Math.floor(m.timeMs / s.intervalMs) * s.intervalMs,
        label: m.label, color: m.color, position: m.position,
      }));
      chartRef.current?.setMarkers(fired);
    } else {
      chartRef.current?.setMarkers([]);
    }

    if (wasPlaying) {
      s.paused = false;
      s.lastReal = null;
      setStatus('playing');
      s.rafId = requestAnimationFrame(tick);
    } else {
      setStatus('paused');
    }
  }, [trades, chartRef, tick, updateOHLCV, updateProgress]);

  const seekBy = useCallback((deltaMs: number) => {
    const s = r.current;
    if (!s.startMs || !trades.length) return;
    const targetMs = Math.max(s.startMs, Math.min(s.endMs, s.vTime + deltaMs));
    const ratio = (targetMs - s.startMs) / (s.endMs - s.startMs);
    seek(ratio);
  }, [seek, trades]);

  const fitContent = useCallback(() => {
    chartRef.current?.fitContent();
  }, [chartRef]);

  const setSpeed = useCallback((s: number) => {
    r.current.speed = s;
    setSpeedState(s);
  }, []);

  const setReplayMarkers = useCallback((markers: ChartMarker[]) => {
    const sorted = [...markers].sort((a, b) => a.timeMs - b.timeMs);
    r.current.markers = sorted;
    r.current.markerIdx = 0;
  }, []);

  return { status, speed, inRangeCount, startReplay, togglePlay, stopReplay, seek, seekBy, setSpeed, fitContent, setReplayMarkers };
}
