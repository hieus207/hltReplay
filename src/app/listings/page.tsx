'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import styles from './listings.module.css';

interface Listing {
  exchange: 'upbit' | 'bithumb';
  symbol: string;
  ann_time: string | null;
  listing_time: string | null;
  source_url: string | null;
}

// "YYYY-MM-DD HH:MM:SS" (UTC+7) → ms UTC
function utc7ToMs(s: string): number {
  const [dp, tp] = s.split(' ');
  const [y, mo, d] = dp.split('-').map(Number);
  const [h, mi, sec] = tp.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h - 7, mi, sec ?? 0);
}

// ms UTC → "YYYY-MM-DDTHH:mm" string in UTC+7 (for datetime-local input in page.tsx)
function msToUTC7Input(ms: number): string {
  const d = new Date(ms + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function buildReplayURL(listing: Listing): string | null {
  if (!listing.ann_time || !listing.listing_time) return null;
  const annMs     = utc7ToMs(listing.ann_time);
  const listingMs = utc7ToMs(listing.listing_time);
  const startMs   = annMs - 5 * 60_000;          // 5 min before announcement
  const endMs     = listingMs + 60 * 60_000;      // 1 hour after listing
  const params = new URLSearchParams({
    symbol:   listing.symbol,
    start:    msToUTC7Input(startMs),
    end:      msToUTC7Input(endMs),
    exchange: listing.exchange,
    ann:      listing.ann_time,
    listing:  listing.listing_time,
  });
  return `/replay?${params.toString()}`;
}

const EXCHANGE_LABEL: Record<string, string> = {
  upbit: 'Upbit',
  bithumb: 'Bithumb',
};

export default function ListingsPage() {
  const [data, setData] = useState<Listing[]>([]);
  const [filter, setFilter] = useState<'all' | 'upbit' | 'bithumb'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/listings.json')
      .then(r => r.json())
      .then(setData)
      .catch(console.error);
  }, []);

  const filtered = useMemo(() => {
    return data.filter(d => {
      if (filter !== 'all' && d.exchange !== filter) return false;
      if (search && !d.symbol.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [data, filter, search]);

  // compute delay (listing_time - ann_time) in minutes
  function delay(item: Listing): string {
    if (!item.ann_time || !item.listing_time) return '—';
    const diff = utc7ToMs(item.listing_time) - utc7ToMs(item.ann_time);
    const mins = Math.round(diff / 60_000);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logo}>⚡ Listing Tracker</span>
          <span className={styles.sub}>Upbit · Bithumb · UTC+7</span>
        </div>
        <Link href="/" className={styles.backBtn}>← Replay</Link>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.filterGroup}>
          {(['all', 'upbit', 'bithumb'] as const).map(ex => (
            <button
              key={ex}
              className={`${styles.filterBtn} ${filter === ex ? styles.filterActive : ''}`}
              onClick={() => setFilter(ex)}
            >
              {ex === 'all' ? 'All' : EXCHANGE_LABEL[ex]}
            </button>
          ))}
        </div>
        <input
          className={styles.search}
          placeholder="Search symbol..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className={styles.count}>{filtered.length} listings</span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Exchange</th>
              <th>Symbol</th>
              <th>Ann Time (UTC+7)</th>
              <th>Listing Time (UTC+7)</th>
              <th>Delay</th>
              <th>Source</th>
              <th>Replay</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item, i) => {
              const replayURL = buildReplayURL(item);
              return (
                <tr key={i} className={styles.row}>
                  <td>
                    <span className={`${styles.badge} ${styles[item.exchange]}`}>
                      {EXCHANGE_LABEL[item.exchange]}
                    </span>
                  </td>
                  <td className={styles.symbol}>{item.symbol}</td>
                  <td className={styles.time}>{item.ann_time ?? '—'}</td>
                  <td className={styles.time}>{item.listing_time ?? '—'}</td>
                  <td className={styles.delayCell}>{delay(item)}</td>
                  <td>
                    {item.source_url
                      ? <a href={item.source_url} target="_blank" rel="noreferrer" className={styles.src}>Notice ↗</a>
                      : '—'}
                  </td>
                  <td>
                    {replayURL
                      ? <Link href={replayURL} className={styles.replayBtn}>▶ Replay</Link>
                      : <span className={styles.noData}>No time data</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
