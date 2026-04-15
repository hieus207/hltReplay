/** Convert UTC ms timestamp → 'YYYY-MM-DDTHH:mm' string in UTC+7, for datetime-local input */
export function msToUTC7Input(ms: number): string {
  const d = new Date(ms + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Parse 'YYYY-MM-DDTHH:mm' (UTC+7 local time) → UTC ms timestamp */
export function parseUTC7Input(s: string): number {
  const [dp, tp] = s.split('T');
  const [y, mo, day] = dp.split('-').map(Number);
  const [h, mi] = tp.split(':').map(Number);
  // Subtract 7h to convert from UTC+7 to UTC
  return Date.UTC(y, mo - 1, day, h - 7, mi, 0, 0);
}

/** Format UTC ms timestamp as 'YYYY-MM-DD HH:mm:ss' in UTC+7 */
export function fmtUTC7(ms: number): string {
  const d = new Date(ms + 7 * 3_600_000);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())} ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`;
}

export function fmtInterval(ms: number): string {
  if (ms < 3_600_000) return `${ms / 60_000}m`;
  return `${ms / 3_600_000}h`;
}

export function fmtPrice(n: number): string {
  return n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

export function fmtCount(n: number): string {
  return n.toLocaleString('en');
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Format market cap / FDV value into readable string: $1.23B, $456M, $12.3K */
export function fmtMCap(n: number): string {
  if (!n || n <= 0) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

/**
 * Auto-detect sensible decimal places from a sample price.
 * e.g. 0.000015 → 8, 0.02597 → 6, 1.234 → 4, 50000 → 2
 */
export function autoDetectDecimals(price: number): number {
  if (!price || price <= 0) return 6;
  if (price >= 1000) return 2;
  if (price >= 1)    return 4;
  // Count significant decimal digits
  const s = price.toFixed(10).replace(/0+$/, '');
  const dotIdx = s.indexOf('.');
  if (dotIdx === -1) return 2;
  // Count leading zeros after decimal point, then add 2 for precision
  const dec = s.slice(dotIdx + 1);
  const leadingZeros = dec.match(/^0*/)?.[0].length ?? 0;
  return Math.min(leadingZeros + 4, 10);
}
