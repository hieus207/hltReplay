'use client';

import { useRef, useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { ChartHandle, ChartMarker, OrderPanelHandle } from '@/hooks/useReplay';
import { useTradeLoader } from '@/hooks/useTradeLoader';
import { useReplay } from '@/hooks/useReplay';
import { parseUTC7Input, fmtInterval, fmtMCap } from '@/lib/format';
import Sidebar from '@/components/Sidebar';
import Controls from '@/components/Controls';
import ChartPanel from '@/components/ChartPanel';
import TradeFeed from '@/components/TradeFeed';
import OrderPanel from '@/components/OrderPanel';
import styles from '../page.module.css';
import rStyles from './replay.module.css';

function ReplayInner() {
  const searchParams = useSearchParams();
  const urlSymbol   = searchParams.get('symbol') ?? '';
  const urlStart    = searchParams.get('start') ?? '';
  const urlEnd      = searchParams.get('end') ?? '';
  const urlExchange = searchParams.get('exchange') ?? '';
  const urlAnn      = searchParams.get('ann') ?? '';
  const urlListing  = searchParams.get('listing') ?? '';
  const isBlind     = searchParams.get('blind') === '1';

  const [revealed, setRevealed] = useState(false);
  const showInfo = !isBlind || revealed;

  const chartRef      = useRef<ChartHandle | null>(null);
  const tradeFeedRef  = useRef<HTMLDivElement | null>(null);
  const orderPanelRef = useRef<OrderPanelHandle | null>(null);
  const decimalsRef   = useRef<number>(6);
  const progFillRef   = useRef<HTMLDivElement | null>(null);
  const progHeadRef   = useRef<HTMLDivElement | null>(null);
  const timeRef       = useRef<HTMLSpanElement | null>(null);
  const ohlcvRef      = useRef<HTMLDivElement | null>(null);
  const entryPriceRef = useRef<HTMLSpanElement | null>(null);
  const entryQtyRef   = useRef<HTMLInputElement | null>(null);
  const limitPriceRef = useRef<HTMLInputElement | null>(null);
  // MC / FDV live display
  const mcRef          = useRef<HTMLSpanElement | null>(null);
  const fdvRef         = useRef<HTMLSpanElement | null>(null);
  const circSupplyRef  = useRef<number>(0);
  const totalSupplyRef = useRef<number>(0);

  const [intervalMs, setIntervalMs] = useState(60_000);
  const [decimals, setDecimals] = useState(6);
  const [replayRange, setReplayRange] = useState({ startMs: 0, endMs: 0 });
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [oneWayMode, setOneWayMode] = useState(false);

  const {
    tradeFile, loading, toast,
    startDt, setStartDt, endDt, setEndDt,
    loadFile, fetchURL, showToast,
  } = useTradeLoader();

  // Parse ann/listing times (format: "YYYY-MM-DD HH:MM:SS" UTC+7) → UTC ms
  const parseUTC7Str = (s: string): number => {
    if (!s) return 0;
    const [dp, tp] = s.split(' ');
    const [y, mo, d] = dp.split('-').map(Number);
    const [h, mi, sec] = tp.split(':').map(Number);
    return Date.UTC(y, mo - 1, d, h - 7, mi, sec ?? 0);
  };
  const annMs     = useMemo(() => parseUTC7Str(urlAnn), [urlAnn]);
  const listingMs = useMemo(() => parseUTC7Str(urlListing), [urlListing]);

  // Chart markers (set after tradeFile loads so chart is ready)
  const chartMarkers = useMemo((): ChartMarker[] => {
    const out: ChartMarker[] = [];
    if (annMs)     out.push({ timeMs: annMs,     label: '📢 Ann',     color: '#f0b90b', position: 'aboveBar' });
    if (listingMs) out.push({ timeMs: listingMs, label: '🚀 Listing', color: '#26a69a', position: 'aboveBar' });
    return out;
  }, [annMs, listingMs]);

  // Re-apply URL params whenever trade file loads (applyTrades inside useTradeLoader overwrites startDt/endDt)
  useEffect(() => {
    if (!tradeFile) return;
    if (urlStart) setStartDt(urlStart);
    if (urlEnd)   setEndDt(urlEnd);
  }, [tradeFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const trades = tradeFile?.trades ?? [];

  const { status, speed, inRangeCount, startReplay, togglePlay, stopReplay, seek, seekBy, setSpeed, fitContent, setReplayMarkers } =
    useReplay(trades, chartRef, {
      progFill: progFillRef, progHead: progHeadRef, timeDisplay: timeRef, ohlcvDisplay: ohlcvRef,
      tradeFeed: tradeFeedRef, orderPanel: orderPanelRef, decimals: decimalsRef,
      entryPriceEl: entryPriceRef,
      mcDisplay: mcRef, fdvDisplay: fdvRef,
      circSupply: circSupplyRef, totalSupply: totalSupplyRef,
    }, showToast);

  // Fetch circulating & total supply from CoinGecko when symbol changes
  useEffect(() => {
    if (!tradeFile?.symbol) { circSupplyRef.current = 0; totalSupplyRef.current = 0; return; }
    const base = tradeFile.symbol.replace(/USDT$/i, '').replace(/USD$/i, '').toLowerCase();
    circSupplyRef.current = 0;
    totalSupplyRef.current = 0;
    if (mcRef.current)  mcRef.current.textContent  = '…';
    if (fdvRef.current) fdvRef.current.textContent = '…';

    (async () => {
      try {
        const s = await fetch(`https://api.coingecko.com/api/v3/search?query=${base}`);
        if (!s.ok) throw new Error();
        const sd = await s.json();
        // Pick first coin whose symbol matches exactly (e.g. "sky")
        const coin = (sd.coins as {id:string;symbol:string}[])
          ?.find(c => c.symbol.toLowerCase() === base);
        if (!coin) throw new Error('not found');
        const d = await fetch(
          `https://api.coingecko.com/api/v3/coins/${coin.id}` +
          `?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
        );
        if (!d.ok) throw new Error();
        const cd = await d.json();
        const circ  = cd.market_data?.circulating_supply ?? 0;
        const total = cd.market_data?.total_supply ?? cd.market_data?.max_supply ?? circ;
        circSupplyRef.current  = circ;
        totalSupplyRef.current = total;
        // Init display with first known price if replay already running
        // (will also be updated on next price tick)
        if (mcRef.current)  mcRef.current.textContent  = circ  > 0 ? fmtMCap(0) : '—';
        if (fdvRef.current) fdvRef.current.textContent = total > 0 ? fmtMCap(0) : '—';
      } catch {
        if (mcRef.current)  mcRef.current.textContent  = '—';
        if (fdvRef.current) fdvRef.current.textContent = '—';
      }
    })();
  }, [tradeFile?.symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStartReplay = () => {
    if (!startDt || !endDt) { showToast('Chọn khung giờ trước!', 'err'); return; }
    const startMs = parseUTC7Input(startDt);
    const endMs   = parseUTC7Input(endDt);
    setReplayRange({ startMs, endMs });
    startReplay(startMs, endMs, intervalMs);
    // Register markers to fire progressively during replay
    if (chartMarkers.length) setReplayMarkers(chartMarkers);
  };

  const [toastVisible, setToastVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setToastVisible(true);
    const t = setTimeout(() => setToastVisible(false), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (tradeFile) {
      setDecimals(tradeFile.autoDecimals);
      decimalsRef.current = tradeFile.autoDecimals;
      chartRef.current?.setPriceDecimals(tradeFile.autoDecimals);
    }
  }, [tradeFile]);

  const handleSetDecimals = (d: number) => {
    setDecimals(d);
    decimalsRef.current = d;
    chartRef.current?.setPriceDecimals(d);
  };

  // Progress bar markers (ratio within replay range)
  const progressMarkers = useMemo(() => {
    const { startMs, endMs } = replayRange;
    if (!startMs || !endMs) return [];
    const range = endMs - startMs;
    const out = [];
    if (annMs && annMs >= startMs && annMs <= endMs)
      out.push({ ratio: (annMs - startMs) / range, label: 'Ann', color: '#f0b90b' });
    if (listingMs && listingMs >= startMs && listingMs <= endMs)
      out.push({ ratio: (listingMs - startMs) / range, label: 'Listing', color: '#26a69a' });
    return out;
  }, [replayRange, annMs, listingMs]);

  // Build suggested download URLs from listing info (ann date + symbol)
  const annDate    = urlAnn ? urlAnn.split(' ')[0] : (urlStart ? urlStart.slice(0, 10) : '');
  const annSymFull = urlSymbol
    ? (urlSymbol.toUpperCase().endsWith('USDT') ? urlSymbol.toUpperCase() : urlSymbol.toUpperCase() + 'USDT')
    : '';

  const suggestedSpotBin = annSymFull && annDate
    ? `https://data.binance.vision/data/spot/daily/aggTrades/${annSymFull}/${annSymFull}-aggTrades-${annDate}.zip`
    : null;
  const suggestedFutBin = annSymFull && annDate
    ? `https://data.binance.vision/data/futures/um/daily/aggTrades/${annSymFull}/${annSymFull}-aggTrades-${annDate}.zip`
    : null;
  const suggestedBybit = annSymFull && annDate
    ? `https://public.bybit.com/trading/${annSymFull}/${annSymFull}${annDate}.csv.gz`
    : null;

  const exchangeLabel: Record<string, string> = { upbit: 'Upbit', bithumb: 'Bithumb' };

  return (
    <div className={styles.app}>

      {/* ── TOP BAR ── */}
      <header className={styles.topbar}>
        <Link href="/listings" className={rStyles.backBtn}>← Listings</Link>
        {isBlind && <span className={rStyles.blindBadge}>🎲 Blind Mode</span>}
        <div className={styles.logo}>⚡ Trade Replay <span>/ Binance aggTrades</span></div>
        {urlSymbol && showInfo && (
          <div className={rStyles.listingBadge}>
            <span className={`${rStyles.exBadge} ${rStyles[urlExchange]}`}>
              {exchangeLabel[urlExchange] ?? urlExchange}
            </span>
            <span className={rStyles.listingSymbol}>{urlSymbol}</span>
          </div>
        )}
        {tradeFile && showInfo && (
          <div className={styles.tag} style={{ marginLeft: 8 }}>
            {tradeFile.symbol} · {fmtInterval(intervalMs)}
          </div>
        )}
        {isBlind && !revealed && (
          <button className={rStyles.revealBtn} onClick={() => setRevealed(true)} >
            👁 Reveal
          </button>
        )}
        <div className={styles.tag} style={{ marginLeft: 'auto' }}>rebuild candles from raw trades</div>
      </header>

      {/* ── LISTING INFO BANNER ── */}
      {urlSymbol && (
        <div className={rStyles.banner}>
          {showInfo ? (
            <>
              <span className={rStyles.bannerItem}>
                📢 Ann: <strong>{urlAnn || urlStart?.replace('T', ' ')}</strong>
              </span>
              <span className={rStyles.bannerSep}>→</span>
              <span className={rStyles.bannerItem}>
                🚀 Listing: <strong>{urlListing || '—'}</strong>
              </span>
            </>
          ) : (
            <span className={rStyles.bannerItem}>
              📢 Ann: <strong>{urlAnn || urlStart?.replace('T', ' ')}</strong>
              <span className={rStyles.bannerSep} style={{ margin: '0 6px' }}>→</span>
              🚀 Listing: <strong>{urlListing || '—'}</strong>
            </span>
          )}
          {(suggestedSpotBin || suggestedFutBin || suggestedBybit) && (
            <>
              <span className={rStyles.bannerSep}>·</span>
              {suggestedSpotBin && (
                <button className={`${rStyles.autoFetchBtn} ${rStyles.fetchBinSpot}`}
                  onClick={() => fetchURL(suggestedSpotBin, isBlind && !revealed)}>
                  ⬇ Spot Bin
                </button>
              )}
              {suggestedFutBin && (
                <button className={`${rStyles.autoFetchBtn} ${rStyles.fetchBinFut}`}
                  onClick={() => fetchURL(suggestedFutBin, isBlind && !revealed)}>
                  ⬇ Futures Bin
                </button>
              )}
              {suggestedBybit && (
                <button className={`${rStyles.autoFetchBtn} ${rStyles.fetchBybit}`}
                  onClick={() => fetchURL(suggestedBybit, isBlind && !revealed)}>
                  ⬇ Bybit
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className={styles.main}>

        {/* ── SIDEBAR ── */}
        <Sidebar
          tradeFile={tradeFile}
          startDt={startDt}
          endDt={endDt}
          intervalMs={intervalMs}
          inRangeCount={inRangeCount}
          decimals={decimals}
          onLoadFile={loadFile}
          onFetchURL={fetchURL}
          onSetStartDt={setStartDt}
          onSetEndDt={setEndDt}
          onSetIntervalMs={setIntervalMs}
          onSetDecimals={handleSetDecimals}
          onStartReplay={handleStartReplay}
          annDate={annDate}
          annSymbol={showInfo ? annSymFull : ''}
          blind={isBlind && !revealed}
        />

        {/* ── CHART WRAP ── */}
        <div className={styles.chartWrap}>
          <div className={styles.chartHeader}>
            <span className={styles.chSymbol}>{showInfo ? (tradeFile?.symbol ?? (urlSymbol || '—')) : '———'}</span>
            <span className={styles.chInterval}>{tradeFile ? fmtInterval(intervalMs) : ''}</span>
            <div className={styles.chOhlcv} ref={ohlcvRef}>
              {!tradeFile && <span style={{ color: 'var(--muted)', fontSize: 12 }}>Load dữ liệu để bắt đầu</span>}
            </div>
            {tradeFile && (
              <div className={styles.chMcFdv}>
                <span className={styles.chMcLabel}>MC</span>
                <span ref={mcRef} className={styles.chMcVal}>—</span>
                <span className={styles.chMcSep}>/</span>
                <span className={styles.chMcLabel}>FDV</span>
                <span ref={fdvRef} className={styles.chMcVal}>—</span>
              </div>
            )}
          </div>
          <div className={styles.chartArea}>
            <ChartPanel ref={chartRef} />
          </div>
          <Controls
            status={status}
            speed={speed}
            startMs={replayRange.startMs}
            endMs={replayRange.endMs}
            progFillRef={progFillRef}
            progHeadRef={progHeadRef}
            timeDisplayRef={timeRef}
            markers={progressMarkers}
            onTogglePlay={togglePlay}
            onStop={stopReplay}
            onSetSpeed={setSpeed}
            onSeek={seek}
            onSeekBy={seekBy}
            onFitContent={fitContent}
          />
          <OrderPanel ref={orderPanelRef} chartRef={chartRef} oneWayMode={oneWayMode} />
        </div>

        {/* ── RIGHT COL 1: Market Trades ── */}
        <div className={styles.feedCol}>
          <div className={styles.colHeader}>MARKET TRADES</div>
          <TradeFeed ref={tradeFeedRef} />
        </div>

        {/* ── RIGHT COL 2: Order Entry ── */}
        <div className={styles.orderCol}>
          <div className={styles.colHeader}>VAO LENH</div>
          <div className={styles.entryForm}>
            <div className={styles.orderTypeRow}>
              <button
                className={`${styles.orderTypeBtn} ${orderType === 'market' ? styles.orderTypeActive : ''}`}
                onClick={() => setOrderType('market')}
              >Market</button>
              <button
                className={`${styles.orderTypeBtn} ${orderType === 'limit' ? styles.orderTypeActive : ''}`}
                onClick={() => setOrderType('limit')}
              >Limit</button>
            </div>
            <div className={styles.entryPriceRow}>
              <span className={styles.entryPriceLbl}>Gia hien tai</span>
              <span ref={entryPriceRef} className={styles.entryPriceVal}>--</span>
            </div>
            {orderType === 'limit' && (
              <div className={styles.entryQtyRow}>
                <span className={styles.entryPriceLbl}>Gia limit</span>
                <input ref={limitPriceRef} className={styles.entryQtyInp} type="number" placeholder="0.00" step="any" min="0" />
              </div>
            )}
            <div className={styles.entryQtyRow}>
              <span className={styles.entryPriceLbl}>Khoi luong (USDT)</span>
              <input ref={entryQtyRef} className={styles.entryQtyInp} type="number" defaultValue="100" min="1" step="10" />
            </div>
            <div className={styles.entryBtns}>
              <button className={styles.longBtn} onClick={() => {
                const u = parseFloat(entryQtyRef.current?.value ?? '100');
                if (!u || u <= 0) return;
                if (orderType === 'limit') {
                  const lp = parseFloat(limitPriceRef.current?.value ?? '0');
                  if (!lp || lp <= 0) return;
                  orderPanelRef.current?.placeLimitOrder('long', lp, u);
                } else { orderPanelRef.current?.openOrder('long', u); }
              }}>&#9650; LONG</button>
              <button className={styles.shortBtn} onClick={() => {
                const u = parseFloat(entryQtyRef.current?.value ?? '100');
                if (!u || u <= 0) return;
                if (orderType === 'limit') {
                  const lp = parseFloat(limitPriceRef.current?.value ?? '0');
                  if (!lp || lp <= 0) return;
                  orderPanelRef.current?.placeLimitOrder('short', lp, u);
                } else { orderPanelRef.current?.openOrder('short', u); }
              }}>&#9660; SHORT</button>
            </div>
            <div className={styles.entryDivider} />
            <label className={styles.oneWayRow}>
              <input type="checkbox" checked={oneWayMode} onChange={e => setOneWayMode(e.target.checked)} className={styles.oneWayCheck} />
              <span className={styles.oneWayLbl}>One-way mode</span>
            </label>
            <div className={styles.posLabel} style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.4 }}>
              {oneWayMode ? 'Short dong Long, Long dong Short' : 'Hedge: nhieu lenh cung chieu'}
            </div>
          </div>
        </div>

      </div>

      {loading.show && (
        <div className="overlay">
          <div className="spin" />
          <div className="ov-text">{loading.text}</div>
          {loading.sub && <div className="ov-sub">{loading.sub}</div>}
        </div>
      )}
      {toast && (
        <div className={`toast ${toast.type} ${toastVisible ? 'show' : ''}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

export default function ReplayPage() {
  return (
    <Suspense>
      <ReplayInner />
    </Suspense>
  );
}
