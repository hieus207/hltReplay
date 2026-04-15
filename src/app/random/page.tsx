'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './random.module.css';

interface Listing {
  exchange: 'upbit' | 'bithumb';
  symbol: string;
  ann_time: string | null;
  listing_time: string | null;
  source_url: string | null;
}

function utc7ToMs(s: string): number {
  const [dp, tp] = s.split(' ');
  const [y, mo, d] = dp.split('-').map(Number);
  const [h, mi, sec] = tp.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h - 7, mi, sec ?? 0);
}

function msToUTC7Input(ms: number): string {
  const d = new Date(ms + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const TIME_RANGES = [
  { label: '1 tuần',  days: 7 },
  { label: '1 tháng', days: 30 },
  { label: '3 tháng', days: 90 },
  { label: '6 tháng', days: 180 },
  { label: '1 năm',   days: 365 },
  { label: 'Tất cả',  days: 0 },
] as const;

export default function RandomPage() {
  const router = useRouter();
  const [data, setData] = useState<Listing[]>([]);
  const [exchange, setExchange] = useState<'all' | 'upbit' | 'bithumb'>('all');
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [picked, setPicked] = useState<Listing | null>(null);
  const [rolling, setRolling] = useState(false);

  useEffect(() => {
    fetch('/listings.json').then(r => r.json()).then(setData).catch(console.error);
  }, []);

  const pool = useMemo(() => {
    const now = Date.now();
    return data.filter(d => {
      if (!d.ann_time || !d.listing_time) return false;
      if (exchange !== 'all' && d.exchange !== exchange) return false;
      if (rangeDays > 0) {
        const ms = utc7ToMs(d.listing_time);
        if (now - ms > rangeDays * 86_400_000) return false;
      }
      return true;
    });
  }, [data, exchange, rangeDays]);

  const roll = useCallback(() => {
    if (!pool.length) return;
    setRolling(true);
    setPicked(null);

    // Slot-machine effect: flash random symbols for 1.2s then settle
    let ticks = 0;
    const MAX_TICKS = 12;
    const interval = setInterval(() => {
      const rand = pool[Math.floor(Math.random() * pool.length)];
      setPicked(rand);
      ticks++;
      if (ticks >= MAX_TICKS) {
        clearInterval(interval);
        setRolling(false);
      }
    }, 100);
  }, [pool]);

  const buildURL = (item: Listing): string => {
    const annMs     = utc7ToMs(item.ann_time!);
    const listingMs = utc7ToMs(item.listing_time!);
    const startMs   = annMs - 5 * 60_000;
    const endMs     = listingMs + 60 * 60_000;
    const params = new URLSearchParams({
      symbol:   item.symbol,
      start:    msToUTC7Input(startMs),
      end:      msToUTC7Input(endMs),
      exchange: item.exchange,
      ann:      item.ann_time!,
      listing:  item.listing_time!,
      blind:    '1',
    });
    return `/replay?${params.toString()}`;
  };

  const go = () => {
    if (!picked || rolling) return;
    router.push(buildURL(picked));
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.logo}>🎲 Random Replay</span>
        <Link href="/listings" className={styles.backBtn}>← Listings</Link>
      </header>

      <div className={styles.body}>
        {/* ── Bộ lọc ── */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>Bộ lọc</div>

          <div className={styles.row}>
            <span className={styles.lbl}>Sàn</span>
            <div className={styles.btnGroup}>
              {(['all', 'upbit', 'bithumb'] as const).map(ex => (
                <button key={ex}
                  className={`${styles.optBtn} ${exchange === ex ? styles.optActive : ''}`}
                  onClick={() => setExchange(ex)}>
                  {ex === 'all' ? 'Tất cả' : ex === 'upbit' ? 'Upbit' : 'Bithumb'}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.row}>
            <span className={styles.lbl}>Thời gian</span>
            <div className={styles.btnGroup}>
              {TIME_RANGES.map(tr => (
                <button key={tr.days}
                  className={`${styles.optBtn} ${rangeDays === tr.days ? styles.optActive : ''}`}
                  onClick={() => setRangeDays(tr.days)}>
                  {tr.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.poolInfo}>
            {pool.length > 0
              ? <>{pool.length} listings trong pool</>
              : <span className={styles.noPool}>Không có listing nào phù hợp</span>}
          </div>
        </div>

        {/* ── Roll ── */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>Kết quả</div>
          <div className={`${styles.slot} ${rolling ? styles.slotRolling : ''}`}>
            {picked ? (
              <>
                <span className={`${styles.exBadge} ${styles[picked.exchange]}`}>
                  {picked.exchange === 'upbit' ? 'Upbit' : 'Bithumb'}
                </span>
                <span className={styles.slotSymbol}>
                  {rolling ? picked.symbol : '???'}
                </span>
                <span className={styles.slotDate}>{picked.listing_time?.split(' ')[0]}</span>
              </>
            ) : (
              <span className={styles.slotPlaceholder}>?</span>
            )}
          </div>

          <div className={styles.actions}>
            <button
              className={styles.rollBtn}
              onClick={roll}
              disabled={!pool.length}>
              🎲 Random
            </button>
            <button
              className={styles.goBtn}
              onClick={go}
              disabled={!picked || rolling}>
              ▶ Bắt đầu Replay
            </button>
          </div>

          {picked && !rolling && (
            <p className={styles.hint}>
              Khi vào replay, symbol sẽ bị ẩn. Ấn <b>Reveal</b> để xem.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
