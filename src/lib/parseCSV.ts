import type { Trade } from '@/types';

export async function parseCSVToTrades(
  csv: string,
  onProgress?: (pct: number) => void,
): Promise<Trade[]> {
  // Split on both Windows (\r\n) and Unix (\n) line endings
  const lines = csv.split(/\r?\n/);
  const result: Trade[] = [];
  let start = 0;

  // Detect format from header row
  const headerLow = lines[0]?.toLowerCase().trim() ?? '';
  // Bybit header: "timestamp,symbol,side,size,price,..."
  const isBybit = headerLow.startsWith('timestamp,symbol');

  // Skip header row if first column is not numeric (both binance and bybit have headers)
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

        if (isBybit) {
          // Bybit columns: [0] timestamp, [1] symbol, [2] side, [3] size, [4] price, ...
          if (cols.length < 5) continue;
          let t    = Number(cols[0].trim());
          const pr = Number(cols[4].trim());
          const qt = Number(cols[3].trim());
          const side = cols[2].trim(); // "Buy" or "Sell"
          // Normalize Bybit timestamps to milliseconds:
          // 19-digit (~1.7e18): nanoseconds  → ÷1e6
          // 16-digit (~1.7e15): microseconds → ÷1e3
          // 13-digit (~1.7e12): milliseconds → no change
          // 10-digit (~1.7e9):  seconds      → ×1e3
          if      (t > 1e17) t = Math.round(t / 1_000_000); // nanoseconds
          else if (t > 1e14) t = Math.round(t / 1_000);     // microseconds
          else if (t < 1e12) t = Math.round(t * 1_000);     // seconds
          if (t > 0 && pr > 0) result.push({
            time: t, price: pr, qty: qt,
            // In Binance convention: isBuyerMaker=true means sell trade
            // Bybit side="Sell" = sell trade → isBuyerMaker=true
            isBuyerMaker: side === 'Sell',
          });
        } else {
          // Binance aggTrades columns:
          // [0] agg_trade_id, [1] price, [2] qty,
          // [3] first_trade_id, [4] last_trade_id, [5] transact_time_ms, [6] is_buyer_maker
          if (cols.length < 6) continue;
          let t    = Number(cols[5].trim());
          const pr = Number(cols[1].trim());
          const qt = Number(cols[2].trim());
          const ibm = cols[6]?.trim();
          // Normalize: Binance newer files may use microseconds (16-digit).
          if (t > 1e17) t = Math.round(t / 1_000_000); // nanoseconds (19-digit)
          else if (t > 1e14) t = Math.round(t / 1000); // microseconds (16-digit)
          if (t > 0 && pr > 0) result.push({
            time: t, price: pr, qty: qt,
            isBuyerMaker: ibm === 'true' || ibm === 'True',
          });
        }
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
  // Binance: BTCUSDT-aggTrades-2026-04-15.zip
  const binanceM = src.match(/([A-Z0-9]+)-aggTrades-(\d{4}-\d{2}-\d{2})/i);
  if (binanceM) return { symbol: binanceM[1].toUpperCase(), tradeDay: binanceM[2] };
  // Bybit: BTCUSDT2026-04-15.csv.gz
  const bybitM = src.match(/([A-Z0-9]+?)(\d{4}-\d{2}-\d{2})/i);
  if (bybitM) return { symbol: bybitM[1].toUpperCase(), tradeDay: bybitM[2] };
  return { symbol: 'UNKNOWN', tradeDay: '' };
}
