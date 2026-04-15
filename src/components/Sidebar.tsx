'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { MarketType, TradeFile } from '@/types';
import { todayStr } from '@/lib/format';
import styles from './Sidebar.module.css';

interface Props {
  tradeFile: TradeFile | null;
  startDt: string;
  endDt: string;
  intervalMs: number;
  inRangeCount: number;
  decimals: number;
  onLoadFile: (f: File) => void;
  onFetchURL: (url: string) => void;
  onSetStartDt: (v: string) => void;
  onSetEndDt: (v: string) => void;
  onSetIntervalMs: (v: number) => void;
  onSetDecimals: (v: number) => void;
  onStartReplay: () => void;
  annDate?: string;    // "2026-03-31" — pre-fill URL generators from listing page
  annSymbol?: string;  // "SKYUSDT"
}

const INTERVALS = [
  { label: '1 phút',  value: 60_000 },
  { label: '3 phút',  value: 180_000 },
  { label: '5 phút',  value: 300_000 },
  { label: '15 phút', value: 900_000 },
  { label: '30 phút', value: 1_800_000 },
  { label: '1 giờ',   value: 3_600_000 },
  { label: '4 giờ',   value: 14_400_000 },
];

export default function Sidebar({
  tradeFile, startDt, endDt, intervalMs, inRangeCount, decimals,
  onLoadFile, onFetchURL, onSetStartDt, onSetEndDt, onSetIntervalMs, onSetDecimals, onStartReplay,
  annDate, annSymbol,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [genSymbol, setGenSymbol] = useState('');
  const [genType, setGenType]     = useState<MarketType>('spot');
  const [genDate, setGenDate]     = useState(todayStr());
  const [genURL, setGenURL]       = useState('');
  const [copied, setCopied]       = useState(false);

  const [bbSymbol, setBbSymbol]   = useState('');
  const [bbDate, setBbDate]       = useState(todayStr());
  const [bbURL, setBbURL]         = useState('');
  const [bbCopied, setBbCopied]   = useState(false);

  const buildURL = useCallback((sym: string, date: string, type: MarketType) => {
    if (!sym || !date) return '';
    return `https://data.binance.vision/data/${type}/daily/aggTrades/${sym}/${sym}-aggTrades-${date}.zip`;
  }, []);

  const buildBybitURL = useCallback((sym: string, date: string) => {
    if (!sym || !date) return '';
    return `https://public.bybit.com/trading/${sym}/${sym}${date}.csv.gz`;
  }, []);

  const handleGenSymbol = (v: string) => {
    const s = v.toUpperCase();
    setGenSymbol(s);
    const u = buildURL(s, genDate, genType);
    setGenURL(u);
    if (u) setUrlInput(u);
  };
  const handleGenDate = (v: string) => {
    setGenDate(v);
    const u = buildURL(genSymbol, v, genType);
    setGenURL(u);
    if (u) setUrlInput(u);
  };
  const handleGenType = (v: MarketType) => {
    setGenType(v);
    const u = buildURL(genSymbol, genDate, v);
    setGenURL(u);
    if (u) setUrlInput(u);
  };

  const copyURL = () => {
    if (!genURL) return;
    navigator.clipboard.writeText(genURL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handleBbSymbol = (v: string) => {
    const s = v.toUpperCase();
    setBbSymbol(s);
    const u = buildBybitURL(s, bbDate);
    setBbURL(u);
    if (u) setUrlInput(u);
  };
  const handleBbDate = (v: string) => {
    setBbDate(v);
    const u = buildBybitURL(bbSymbol, v);
    setBbURL(u);
    if (u) setUrlInput(u);
  };

  const copyBbURL = () => {
    if (!bbURL) return;
    navigator.clipboard.writeText(bbURL).then(() => {
      setBbCopied(true);
      setTimeout(() => setBbCopied(false), 2500);
    });
  };

  // Auto-fill URL generators when coming from a listing page (ann date + symbol known)
  useEffect(() => {
    if (!annSymbol && !annDate) return;
    const sym  = annSymbol || genSymbol;
    const date = annDate   || genDate;
    if (annDate)   { setGenDate(annDate);   setBbDate(annDate); }
    if (annSymbol) { setGenSymbol(annSymbol); setBbSymbol(annSymbol); }
    if (sym && date) {
      const u  = buildURL(sym, date, genType);
      const bu = buildBybitURL(sym, date);
      if (u)  { setGenURL(u);  setUrlInput(u); }
      if (bu) setBbURL(bu);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annDate, annSymbol]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onLoadFile(f);
  };

  return (
    <aside className={styles.sidebar}>

      {/* ── LOAD DATA ── */}
      <section>
        <div className={styles.sLabel}>Load Data</div>

        <div
          className={`${styles.dropZone} ${dragging ? styles.over : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.csv"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoadFile(f); e.target.value = ''; }}
          />
          <div className={styles.dzIcon}>📦</div>
          <div className={styles.dzText}>
            <b>Kéo thả .zip vào đây</b>
            <br />hoặc click để chọn file
          </div>
        </div>

        {tradeFile && (
          <div className={styles.loadedBadge}>
            <div className={styles.lbName}>
              {tradeFile.symbol} · {tradeFile.source === 'bybit' ? 'Bybit Trades' : 'aggTrades'}
            </div>
            <div className={styles.lbMeta}>
              {tradeFile.tradeDay} — {tradeFile.trades.length.toLocaleString('en')} trades
            </div>
          </div>
        )}

        <div className={styles.orDivider}>hoặc dùng URL</div>

        <div className={styles.row}>
          <input
            className={styles.inp}
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://data.binance.vision/..."
          />
          <button className={styles.btn} onClick={() => onFetchURL(urlInput)}>Tải</button>
        </div>
        <p className={styles.hint}>
          ⚠ CORS có thể block. Nên <b>tải thủ công</b> rồi import file.
        </p>
      </section>

      {/* ── URL GENERATOR ── */}
      <section>
        <div className={styles.sLabel}>Tạo URL tải nhanh</div>
        <div className={styles.urlGen}>
          <div className={styles.urlGenTitle}>Tạo link Binance aggTrades</div>
          <div className={styles.row}>
            <input
              className={styles.inp}
              placeholder="BTCUSDT / ZAMAUSTD"
              value={genSymbol}
              onChange={(e) => handleGenSymbol(e.target.value)}
            />
            <select className={`${styles.inp} ${styles.typeSelect}`} value={genType}
              onChange={(e) => handleGenType(e.target.value as MarketType)}>
              <option value="spot">Spot</option>
              <option value="futures/um">Futures</option>
            </select>
          </div>
          <input
            type="date" className={styles.inp}
            value={genDate} onChange={(e) => handleGenDate(e.target.value)}
          />
          {genURL && (
            <div className={styles.urlResult} onClick={copyURL} title="Click để copy">
              {genURL}
            </div>
          )}
          {copied && <p className={styles.hint} style={{ color: 'var(--green2)' }}>✓ Đã copy!</p>}
        </div>

        <div className={`${styles.urlGen} ${styles.urlGenBybit}`}>
          <div className={styles.urlGenTitle}>Tạo link Bybit Public Trades</div>
          <input
            className={styles.inp}
            placeholder="BTCUSDT"
            value={bbSymbol}
            onChange={(e) => handleBbSymbol(e.target.value)}
          />
          <input
            type="date" className={styles.inp}
            value={bbDate} onChange={(e) => handleBbDate(e.target.value)}
          />
          {bbURL && (
            <div className={styles.urlResult} onClick={copyBbURL} title="Click để copy">
              {bbURL}
            </div>
          )}
          {bbCopied && <p className={styles.hint} style={{ color: 'var(--green2)' }}>✓ Đã copy!</p>}
        </div>
      </section>

      {/* ── REPLAY SETTINGS ── */}
      <section>
        <div className={styles.sLabel}>Cài đặt Replay</div>

        <div className={styles.formRow}>
          <label>Khung nến</label>
          <select className={styles.inp} value={intervalMs}
            onChange={(e) => onSetIntervalMs(Number(e.target.value))}>
            {INTERVALS.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
        </div>

        <div className={styles.formRow}>
          <label>Từ (UTC+7)</label>
          <input type="datetime-local" className={styles.inp}
            value={startDt} onChange={(e) => onSetStartDt(e.target.value)} />
        </div>

        <div className={styles.formRow}>
          <label>Đến (UTC+7)</label>
          <input type="datetime-local" className={styles.inp}
            value={endDt} onChange={(e) => onSetEndDt(e.target.value)} />
        </div>

        <div className={styles.formRow}>
          <label>Số chữ số thập phân (giá)</label>
          <div className={styles.row} style={{ alignItems: 'center', gap: 6 }}>
            <input
              type="range" min={1} max={10} step={1}
              value={decimals}
              onChange={(e) => onSetDecimals(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 12, color: 'var(--accent)', minWidth: 18, textAlign: 'right' }}>{decimals}</span>
          </div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
            {[2, 4, 5, 6, 8].map((d) => (
              <button
                key={d}
                className={`${styles.btn} ${styles.btnSmall} ${decimals === d ? styles.btnActive : styles.btnGhost}`}
                onClick={() => onSetDecimals(d)}
              >
                .{d.toString().padStart(1, '0')}
              </button>
            ))}
          </div>
        </div>

        <button
          className={`${styles.btn} ${styles.btnBlock}`}
          disabled={!tradeFile}
          onClick={onStartReplay}
        >
          ▶&nbsp; Bắt đầu Replay
        </button>
      </section>

      {/* ── STATS ── */}
      {tradeFile && (
        <section>
          <div className={styles.sLabel}>Thống kê</div>
          <div className={styles.stats}>
            <div>Symbol: <span className={styles.accent}>{tradeFile.symbol}</span></div>
            <div>Ngày: <span>{tradeFile.tradeDay}</span></div>
            <div>Tổng trades: <span>{tradeFile.trades.length.toLocaleString('en')}</span></div>
            <div>In range: <span>{inRangeCount > 0 ? inRangeCount.toLocaleString('en') : '—'}</span></div>
          </div>
        </section>
      )}

    </aside>
  );
}
