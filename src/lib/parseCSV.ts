import type { Trade } from '@/types';

export async function parseCSVToTrades(
  csv: string,
  onProgress?: (pct: number) => void,
): Promise<Trade[]> {
  // Split on both Windows (\r\n) and Unix (\n) line endings
  const lines = csv.split(/\r?\n/);
  const result: Trade[] = [];
  let start = 0;

  // Skip header row if first column is not numeric
  if (lines[0] && isNaN(Number(lines[0].split(',')[0]?.trim()))) {
    start = 1;
  }

  await new Promise<void>((resolve) => {
    let i = start;
    const CHUNK = 100_000;

    function processChunk() {
      const end = Math.min(i + CHUNK, lines.length);
      for (; i < end; i++) {
        const ln = lines[i];
        if (!ln) continue;
        const cols = ln.split(',');
        if (cols.length < 6) continue;
        // Binance aggTrades columns:
        // [0] agg_trade_id, [1] price, [2] qty,
        // [3] first_trade_id, [4] last_trade_id, [5] transact_time_ms, [6] is_buyer_maker
        let t    = Number(cols[5].trim());
        const pr = Number(cols[1].trim());
        const qt = Number(cols[2].trim());
        const ibm = cols[6]?.trim();
        // Normalize: Binance newer files may use microseconds (16 digits).
        // Reasonable Unix ms for 2015-2040: 1.4e12 – 2.2e12 (13 digits).
        // If >1e13, it's μs → divide by 1000.
        if (t > 1e13) t = Math.round(t / 1000);
        if (t > 0 && pr > 0) result.push({
          time: t, price: pr, qty: qt,
          isBuyerMaker: ibm === 'true' || ibm === 'True',
        });
      }
      onProgress?.(Math.round((i / lines.length) * 100));
      if (i < lines.length) setTimeout(processChunk, 0);
      else resolve();
    }
    processChunk();
  });

  return result;
}

export function detectMeta(src: string): { symbol: string; tradeDay: string } {
  const m = src.match(/([A-Z0-9]+)-aggTrades-(\d{4}-\d{2}-\d{2})/i);
  return {
    symbol: m ? m[1].toUpperCase() : 'UNKNOWN',
    tradeDay: m ? m[2] : '',
  };
}
