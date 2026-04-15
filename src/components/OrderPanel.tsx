'use client';
import {
  useRef, useReducer, useCallback, useState, useEffect,
  forwardRef, useImperativeHandle,
} from 'react';
import type { OrderPanelHandle } from '@/types';
import type { ChartHandle } from '@/hooks/useReplay';
import { fmtUTC7 } from '@/lib/format';
import styles from './OrderPanel.module.css';

export interface Position {
  id: number;
  side: 'long' | 'short';
  entry: number;
  qty: number;
  usdt: number;
  openTime: number;  // replay ms
}

export interface ClosedPosition {
  id: number;
  side: 'long' | 'short';
  entry: number;
  exit: number;
  usdt: number;
  pnl: number;
  openTime: number;
  closeTime: number;
}

export interface PendingOrder {
  id: number;
  side: 'long' | 'short';
  limitPrice: number;
  usdt: number;
  placedTime: number;
}

export interface OrderRecord {
  id: number;          // unique log id
  orderId: number;     // original order id
  side: 'long' | 'short';
  type: 'Market' | 'Limit';
  status: 'Filled' | 'Cancelled';
  price: number;       // fill price or limit price
  usdt: number;
  time: number;        // replay ms of event
}

let _nextId = 1;

interface Props {
  chartRef: React.RefObject<ChartHandle | null>;
  oneWayMode: boolean;
}

const OrderPanel = forwardRef<OrderPanelHandle, Props>(({ chartRef, oneWayMode }, ref) => {
  const priceRef      = useRef(0);
  const decimalsRef   = useRef(5);
  const replayTimeRef = useRef(0);
  const posRef        = useRef<Position[]>([]);
  const pendingRef    = useRef<PendingOrder[]>([]);
  const oneWayRef     = useRef(false);
  const pnlElsRef     = useRef<Map<number, HTMLSpanElement>>(new Map());
  const markElsRef    = useRef<Map<number, HTMLSpanElement>>(new Map());
  const roiElsRef     = useRef<Map<number, HTMLSpanElement>>(new Map());
  const totalPnlRef   = useRef<HTMLSpanElement>(null);
  const [, forceRender] = useReducer(x => x + 1, 0);

  const [history, setHistory] = useState<ClosedPosition[]>([]);
  const [tab, setTab] = useState<'positions' | 'pending' | 'history' | 'orders'>('positions');
  const [partialPcts, setPartialPcts] = useState<Record<number, string>>({});
  const [orderLog, setOrderLog] = useState<OrderRecord[]>([]);

  // Sync oneWayMode prop into ref so callbacks can read it without re-creating
  useEffect(() => { oneWayRef.current = oneWayMode; }, [oneWayMode]);

  // Core add-position logic shared by market open and limit fill
  const _addPosition = useCallback((
    side: 'long' | 'short', fillPrice: number, usdt: number, openTime: number,
  ): number => {
    let remainingUsdt = usdt;

    // One-way mode: net against opposites first (like exchange netting)
    if (oneWayRef.current) {
      const opposites = posRef.current.filter(p => p.side !== side);
      const fullyClosedIds: number[] = [];

      for (const opp of opposites) {
        if (remainingUsdt <= 0) break;
        const closeUsdt = Math.min(remainingUsdt, opp.usdt);
        const ratio     = closeUsdt / opp.usdt;
        const closedQty = opp.qty * ratio;
        const pnl = (fillPrice - opp.entry) * closedQty * (opp.side === 'long' ? 1 : -1);
        remainingUsdt -= closeUsdt;

        setHistory(h => {
          const ex = h.find(e => e.id === opp.id);
          if (ex) {
            const totalU = ex.usdt + closeUsdt;
            const avgEx = totalU > 0 ? (ex.exit * ex.usdt + fillPrice * closeUsdt) / totalU : fillPrice;
            return h.map(e => e.id === opp.id
              ? { ...e, exit: avgEx, usdt: totalU, pnl: ex.pnl + pnl, closeTime: replayTimeRef.current } : e);
          }
          return [{ id: opp.id, side: opp.side, entry: opp.entry, exit: fillPrice,
            usdt: closeUsdt, pnl, openTime: opp.openTime, closeTime: replayTimeRef.current }, ...h];
        });

        if (ratio >= 0.9999) {
          // Fully close this opposite position
          fullyClosedIds.push(opp.id);
          pnlElsRef.current.delete(opp.id);
          markElsRef.current.delete(opp.id);
          roiElsRef.current.delete(opp.id);
          chartRef.current?.removePriceLine(opp.id);
        } else {
          // Partial close — reduce size, update price line label
          const newOppUsdt = opp.usdt - closeUsdt;
          posRef.current = posRef.current.map(p =>
            p.id === opp.id ? { ...p, qty: p.qty * (1 - ratio), usdt: newOppUsdt } : p,
          );
          const oppColor = opp.side === 'long' ? '#26a69a' : '#ef5350';
          chartRef.current?.addPriceLine(opp.id, opp.entry, oppColor,
            (opp.side === 'long' ? 'L ' : 'S ') + newOppUsdt.toFixed(0) + 'U');
        }
      }

      posRef.current = posRef.current.filter(p => !fullyClosedIds.includes(p.id));

      // Fully netted — no new position needed
      if (remainingUsdt < 0.01) return -1;
    }

    // Open new position with remaining USDT
    const qty = remainingUsdt / fillPrice;
    const id = _nextId++;
    posRef.current = [...posRef.current, { id, side, entry: fillPrice, qty, usdt: remainingUsdt, openTime }];
    const color = side === 'long' ? '#26a69a' : '#ef5350';
    chartRef.current?.addPriceLine(id, fillPrice, color,
      (side === 'long' ? 'L ' : 'S ') + remainingUsdt.toFixed(0) + 'U');
    return id;
  }, [chartRef]);

  useImperativeHandle(ref, () => ({
    notifyPrice(price, decimals, replayTimeMs) {
      priceRef.current = price;
      decimalsRef.current = decimals;
      if (replayTimeMs > 0) replayTimeRef.current = replayTimeMs;
      let total = 0;
      for (const pos of posRef.current) {
        const pnl = (price - pos.entry) * pos.qty * (pos.side === 'long' ? 1 : -1);
        const roi = pos.usdt > 0 ? (pnl / pos.usdt) * 100 : 0;
        total += pnl;
        const pnlEl = pnlElsRef.current.get(pos.id);
        if (pnlEl) {
          pnlEl.textContent = (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + 'U';
          pnlEl.className = styles.posPnl + ' ' + (pnl >= 0 ? styles.pnlUp : styles.pnlDn);
        }
        const markEl = markElsRef.current.get(pos.id);
        if (markEl) markEl.textContent = price.toFixed(decimals);
        const roiEl = roiElsRef.current.get(pos.id);
        if (roiEl) {
          roiEl.textContent = (roi >= 0 ? '+' : '') + roi.toFixed(2) + '%';
          roiEl.className = styles.posRoi + ' ' + (pnl >= 0 ? styles.pnlUp : styles.pnlDn);
        }
      }
      if (totalPnlRef.current) {
        totalPnlRef.current.textContent = (total >= 0 ? '+' : '') + total.toFixed(2) + 'U';
        totalPnlRef.current.className =
          styles.totalPnlVal + ' ' + (total > 0 ? styles.pnlUp : total < 0 ? styles.pnlDn : styles.pnlNeutral);
      }
      // Check pending limit orders for fill
      const filled = pendingRef.current.filter(p =>
        (p.side === 'long'  && price <= p.limitPrice) ||
        (p.side === 'short' && price >= p.limitPrice),
      );
      if (filled.length > 0) {
        pendingRef.current = pendingRef.current.filter(p => !filled.some(f => f.id === p.id));
        for (const pend of filled) {
          chartRef.current?.removePriceLine(pend.id);
          _addPosition(pend.side, pend.limitPrice, pend.usdt, pend.placedTime);
          setOrderLog(l => [{ id: _nextId++, orderId: pend.id, side: pend.side, type: 'Limit',
            status: 'Filled', price: pend.limitPrice, usdt: pend.usdt, time: replayTimeRef.current }, ...l]);
        }
        forceRender();
      }
    },
    reset() {
      for (const pos of posRef.current) chartRef.current?.removePriceLine(pos.id);
      for (const pend of pendingRef.current) chartRef.current?.removePriceLine(pend.id);
      posRef.current = [];
      pendingRef.current = [];
      pnlElsRef.current.clear();
      markElsRef.current.clear();
      roiElsRef.current.clear();
      setHistory([]);
      setOrderLog([]);
      setPartialPcts({});
      forceRender();
    },
    openOrder(side, usdt) {
      const price = priceRef.current;
      if (!price || !usdt || isNaN(usdt) || usdt <= 0) return;
      const posId = _addPosition(side, price, usdt, replayTimeRef.current);
      setOrderLog(l => [{ id: _nextId++, orderId: posId, side, type: 'Market',
        status: 'Filled', price, usdt, time: replayTimeRef.current }, ...l]);
      forceRender();
    },
    placeLimitOrder(side, limitPrice, usdt) {
      if (!limitPrice || limitPrice <= 0 || !usdt || isNaN(usdt) || usdt <= 0) return;
      const id = _nextId++;
      pendingRef.current = [...pendingRef.current, { id, side, limitPrice, usdt, placedTime: replayTimeRef.current }];
      const color = side === 'long' ? 'rgba(38,166,154,0.55)' : 'rgba(239,83,80,0.55)';
      chartRef.current?.addPriceLine(id, limitPrice, color,
        (side === 'long' ? 'L⏳ ' : 'S⏳ ') + usdt.toFixed(0) + 'U');
      forceRender();
    },
  }));

  const closePos = useCallback((id: number, closePct = 100) => {
    const pos = posRef.current.find(p => p.id === id);
    if (!pos) return;
    const price = priceRef.current;
    const ratio = Math.min(Math.max(closePct, 1), 100) / 100;
    const closedQty  = pos.qty  * ratio;
    const closedUsdt = pos.usdt * ratio;
    const pnl = (price - pos.entry) * closedQty * (pos.side === 'long' ? 1 : -1);

    // Merge into existing history entry (same pos.id) instead of creating duplicate
    setHistory(h => {
      const existing = h.find(e => e.id === pos.id);
      if (existing) {
        const totalUsdt = existing.usdt + closedUsdt;
        const avgExit = totalUsdt > 0
          ? (existing.exit * existing.usdt + price * closedUsdt) / totalUsdt
          : price;
        return h.map(e => e.id === pos.id
          ? { ...e, exit: avgExit, usdt: totalUsdt, pnl: e.pnl + pnl, closeTime: replayTimeRef.current }
          : e,
        );
      }
      return [{ id: pos.id, side: pos.side, entry: pos.entry, exit: price, usdt: closedUsdt, pnl, openTime: pos.openTime, closeTime: replayTimeRef.current }, ...h];
    });

    if (ratio >= 0.9999) {
      posRef.current = posRef.current.filter(p => p.id !== id);
      pnlElsRef.current.delete(id);
      markElsRef.current.delete(id);
      roiElsRef.current.delete(id);
      chartRef.current?.removePriceLine(id);
    } else {
      posRef.current = posRef.current.map(p =>
        p.id === id ? { ...p, qty: p.qty * (1 - ratio), usdt: p.usdt * (1 - ratio) } : p,
      );
      const remaining = pos.usdt * (1 - ratio);
      const color = pos.side === 'long' ? '#26a69a' : '#ef5350';
      chartRef.current?.addPriceLine(id, pos.entry, color,
        (pos.side === 'long' ? 'L ' : 'S ') + remaining.toFixed(0) + 'U');
    }
    setPartialPcts(p => { const n = { ...p }; delete n[id]; return n; });
    forceRender();
  }, [chartRef]);

  const closeAll = useCallback(() => {
    const price = priceRef.current;
    const closing = posRef.current;
    for (const pos of closing) chartRef.current?.removePriceLine(pos.id);
    posRef.current = [];
    pnlElsRef.current.clear();
    markElsRef.current.clear();
    roiElsRef.current.clear();
    setHistory(h => {
      let updated = [...h];
      for (const pos of closing) {
        const pnl = (price - pos.entry) * pos.qty * (pos.side === 'long' ? 1 : -1);
        const existing = updated.find(e => e.id === pos.id);
        if (existing) {
          const totalUsdt = existing.usdt + pos.usdt;
          const avgExit = totalUsdt > 0
            ? (existing.exit * existing.usdt + price * pos.usdt) / totalUsdt
            : price;
          updated = updated.map(e => e.id === pos.id
            ? { ...e, exit: avgExit, usdt: totalUsdt, pnl: e.pnl + pnl, closeTime: replayTimeRef.current }
            : e,
          );
        } else {
          updated = [{ id: pos.id, side: pos.side, entry: pos.entry, exit: price, usdt: pos.usdt, pnl, openTime: pos.openTime, closeTime: replayTimeRef.current }, ...updated];
        }
      }
      return updated;
    });
    setPartialPcts({});
    forceRender();
  }, [chartRef]);

  const cancelPending = useCallback((id: number) => {
    const pend = pendingRef.current.find(p => p.id === id);
    pendingRef.current = pendingRef.current.filter(p => p.id !== id);
    chartRef.current?.removePriceLine(id);
    if (pend) {
      setOrderLog(l => [{ id: _nextId++, orderId: pend.id, side: pend.side, type: 'Limit',
        status: 'Cancelled', price: pend.limitPrice, usdt: pend.usdt, time: replayTimeRef.current }, ...l]);
    }
    forceRender();
  }, [chartRef]);

  const positions = posRef.current;
  const pending   = pendingRef.current;
  const dec = decimalsRef.current;
  const totalHistPnl = history.reduce((s, h) => s + h.pnl, 0);

  return (
    <div className={styles.bar}>
      {/* Header: tabs + total PnL + close all */}
      <div className={styles.barHeader}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'positions' ? styles.tabActive : ''}`}
            onClick={() => setTab('positions')}
          >
            Vi the{positions.length > 0 && <span className={styles.cnt}>{positions.length}</span>}
          </button>
          <button
            className={`${styles.tab} ${tab === 'pending' ? styles.tabActive : ''}`}
            onClick={() => setTab('pending')}
          >
            Lenh cho{pending.length > 0 && <span className={styles.cnt}>{pending.length}</span>}
          </button>
          <button
            className={`${styles.tab} ${tab === 'history' ? styles.tabActive : ''}`}
            onClick={() => setTab('history')}
          >
            Lich su{history.length > 0 && (
              <span className={`${styles.cnt} ${totalHistPnl >= 0 ? styles.pnlUp : styles.pnlDn}`}>
                {totalHistPnl >= 0 ? '+' : ''}{totalHistPnl.toFixed(2)}U
              </span>
            )}
          </button>
          <button
            className={`${styles.tab} ${tab === 'orders' ? styles.tabActive : ''}`}
            onClick={() => setTab('orders')}
          >
            Don hang{orderLog.length > 0 && <span className={styles.cnt}>{orderLog.length}</span>}
          </button>
        </div>
        {positions.length > 0 && (
          <span className={styles.totalPnlWrap}>
            Total PnL: <span ref={totalPnlRef} className={`${styles.totalPnlVal} ${styles.pnlNeutral}`}>+0.00U</span>
          </span>
        )}
        {positions.length > 0 && (
          <button className={styles.closeAllBtn} onClick={closeAll}>Dong tat ca</button>
        )}
      </div>

      {/* Vi the tab: open positions only */}
      {tab === 'positions' && (
        <div className={styles.tableWrap}>
          <div className={styles.colHeader}>
            <span className={styles.colLabel}>Side</span>
            <span className={styles.colLabel}>Entry Price</span>
            <span className={styles.colLabel}>Size (U)</span>
            <span className={styles.colLabel}>Mark Price</span>
            <span className={styles.colLabel}>PnL (U)</span>
            <span className={styles.colLabel}>ROI %</span>
            <span className={styles.colLabel}></span>
          </div>
          {positions.length === 0 ? (
            <span className={styles.empty}>No open positions</span>
          ) : positions.map(pos => {
            const pct = partialPcts[pos.id] ?? '';
            return (
              <div key={pos.id} className={styles.posRow}>
                <span className={`${styles.badge} ${pos.side === 'long' ? styles.badgeUp : styles.badgeDn}`}>
                  {pos.side === 'long' ? 'Long' : 'Short'}
                </span>
                <span className={styles.posEntry}>{pos.entry.toFixed(dec)}</span>
                <span className={styles.posSize}>{pos.usdt.toFixed(0)}</span>
                <span
                  className={styles.posMark}
                  ref={el => { if (el) markElsRef.current.set(pos.id, el); else markElsRef.current.delete(pos.id); }}
                >{priceRef.current ? priceRef.current.toFixed(dec) : '--'}</span>
                <span
                  className={`${styles.posPnl} ${styles.pnlNeutral}`}
                  ref={el => { if (el) pnlElsRef.current.set(pos.id, el); else pnlElsRef.current.delete(pos.id); }}
                >+0.00U</span>
                <span
                  className={`${styles.posRoi} ${styles.pnlNeutral}`}
                  ref={el => { if (el) roiElsRef.current.set(pos.id, el); else roiElsRef.current.delete(pos.id); }}
                >+0.00%</span>
                <div className={styles.actCell}>
                  <input
                    className={styles.pctInp} type="number" min="1" max="99"
                    placeholder="%" value={pct}
                    onChange={e => setPartialPcts(p => ({ ...p, [pos.id]: e.target.value }))}
                  />
                  <button
                    className={styles.partialBtn}
                    onClick={() => closePos(pos.id, pct ? parseFloat(pct) : 50)}
                  >{pct ? `${pct}%` : '50%'}</button>
                  <button className={styles.closeBtn} onClick={() => closePos(pos.id, 100)}>&#x2715;</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lenh cho tab: pending limit orders only */}
      {tab === 'pending' && (
        <div className={styles.tableWrap}>
          <div className={styles.colHeaderP}>
            <span className={styles.colLabel}>Side</span>
            <span className={styles.colLabel}>Limit Price</span>
            <span className={styles.colLabel}>Size (U)</span>
            <span className={styles.colLabel}>Placed</span>
            <span className={styles.colLabel}></span>
          </div>
          {pending.length === 0 ? (
            <span className={styles.empty}>No pending orders</span>
          ) : pending.map(p => (
            <div key={p.id} className={styles.pendingRow}>
              <span className={`${styles.badge} ${p.side === 'long' ? styles.badgeUp : styles.badgeDn}`}>
                {p.side === 'long' ? 'Long' : 'Short'}
              </span>
              <span className={styles.posEntry}>{p.limitPrice.toFixed(dec)}</span>
              <span className={styles.posSize}>{p.usdt.toFixed(0)}</span>
              <span className={styles.posTime}>{p.placedTime > 0 ? fmtUTC7(p.placedTime).slice(5) : '--'}</span>
              <button className={styles.closeBtn} onClick={() => cancelPending(p.id)}>&#x2715;</button>
            </div>
          ))}
        </div>
      )}

      {/* History table */}
      {tab === 'history' && (
        <div className={styles.tableWrap}>
          <div className={styles.colHeaderH}>
            <span className={styles.colLabel}>Side</span>
            <span className={styles.colLabel}>Entry Price</span>
            <span className={styles.colLabel}>Exit Price</span>
            <span className={styles.colLabel}>Size (U)</span>
            <span className={styles.colLabel}>Realized PnL</span>
            <span className={styles.colLabel}>ROI %</span>
            <span className={styles.colLabel}>Open Time</span>
            <span className={styles.colLabel}>Close Time</span>
          </div>
          {history.length === 0 ? (
            <span className={styles.empty}>No closed positions yet</span>
          ) : history.map(h => (
            <div key={h.id} className={styles.histRow}>
              <span className={`${styles.badge} ${h.side === 'long' ? styles.badgeUp : styles.badgeDn}`}>
                {h.side === 'long' ? 'Long' : 'Short'}
              </span>
              <span className={styles.posEntry}>{h.entry.toFixed(dec)}</span>
              <span className={styles.posEntry}>{h.exit.toFixed(dec)}</span>
              <span className={styles.posSize}>{h.usdt.toFixed(0)}</span>
              <span className={`${styles.posPnl} ${h.pnl >= 0 ? styles.pnlUp : styles.pnlDn}`}>
                {h.pnl >= 0 ? '+' : ''}{h.pnl.toFixed(2)}U
              </span>
              <span className={`${styles.posRoi} ${h.pnl >= 0 ? styles.pnlUp : styles.pnlDn}`}>
                {h.pnl >= 0 ? '+' : ''}{(h.usdt > 0 ? h.pnl / h.usdt * 100 : 0).toFixed(2)}%
              </span>
              <span className={styles.posTime}>{h.openTime  > 0 ? fmtUTC7(h.openTime).slice(5)  : '--'}</span>
              <span className={styles.posTime}>{h.closeTime > 0 ? fmtUTC7(h.closeTime).slice(5) : '--'}</span>
            </div>
          ))}
        </div>
      )}
      {/* Order log table */}
      {tab === 'orders' && (
        <div className={styles.tableWrap}>
          <div className={styles.colHeaderO}>
            <span className={styles.colLabel}>Side</span>
            <span className={styles.colLabel}>Type</span>
            <span className={styles.colLabel}>Status</span>
            <span className={styles.colLabel}>Price</span>
            <span className={styles.colLabel}>Size (U)</span>
            <span className={styles.colLabel}>Time</span>
          </div>
          {orderLog.length === 0 ? (
            <span className={styles.empty}>No orders yet</span>
          ) : orderLog.map(o => (
            <div key={o.id} className={styles.orderRow}>
              <span className={`${styles.badge} ${o.side === 'long' ? styles.badgeUp : styles.badgeDn}`}>
                {o.side === 'long' ? 'Long' : 'Short'}
              </span>
              <span className={styles.orderType}>{o.type}</span>
              <span className={`${styles.orderStatus} ${o.status === 'Filled' ? styles.statusFilled : styles.statusCancelled}`}>
                {o.status}
              </span>
              <span className={styles.posEntry}>{o.price.toFixed(dec)}</span>
              <span className={styles.posSize}>{o.usdt.toFixed(0)}</span>
              <span className={styles.posTime}>{o.time > 0 ? fmtUTC7(o.time).slice(5) : '--'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
OrderPanel.displayName = 'OrderPanel';
export default OrderPanel;