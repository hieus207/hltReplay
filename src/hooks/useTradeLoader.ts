'use client';

import { useState, useCallback } from 'react';
import type { TradeFile, MarketType } from '@/types';
import { parseCSVToTrades, detectMeta } from '@/lib/parseCSV';
import { msToUTC7Input, autoDetectDecimals } from '@/lib/format';

export interface LoadingState {
  show: boolean;
  text: string;
  sub: string;
}

export interface ToastState {
  id: number;
  msg: string;
  type: 'ok' | 'err' | 'info';
}

let _toastId = 0;

export function useTradeLoader() {
  const [tradeFile, setTradeFile] = useState<TradeFile | null>(null);
  const [loading, setLoading] = useState<LoadingState>({ show: false, text: '', sub: '' });
  const [toast, setToast] = useState<ToastState | null>(null);
  // Default datetime-local range (UTC+7)
  const [startDt, setStartDt] = useState('');
  const [endDt, setEndDt] = useState('');

  const showToast = useCallback((msg: string, type: ToastState['type'] = 'info') => {
    setToast({ id: ++_toastId, msg, type });
  }, []);

  const applyTrades = useCallback(
    async (csvText: string, sourceName: string) => {
      const { symbol, tradeDay, source } = detectMeta(sourceName);

      setLoading({ show: true, text: 'Đang parse trades...', sub: sourceName.slice(-50) });

      const trades = await parseCSVToTrades(csvText, (pct) => {
        setLoading((l) => ({ ...l, text: `Parse... ${pct}%` }));
      });

      if (trades.length === 0) {
        setLoading({ show: false, text: '', sub: '' });
        showToast('File không có trade nào hợp lệ!', 'err');
        return;
      }

      // BUG FIX: Set default range from ACTUAL trade timestamps (not from filename date).
      // This ensures the default selection always contains trades.
      const minMs = trades[0].time;
      const maxMs = trades[trades.length - 1].time;
      setStartDt(msToUTC7Input(minMs));
      setEndDt(msToUTC7Input(maxMs));

      // Auto-detect decimals from a middle-of-file sample price for robustness
      const samplePrice = trades[Math.floor(trades.length / 2)].price;
      const autoDecimals = autoDetectDecimals(samplePrice);

      setTradeFile({ symbol, tradeDay, trades, autoDecimals, source });
      setLoading({ show: false, text: '', sub: '' });
      showToast(`Loaded ${trades.length.toLocaleString('en')} trades ✓`, 'ok');
    },
    [showToast],
  );

  const loadFile = useCallback(
    async (file: File) => {
      setLoading({ show: true, text: 'Đang đọc file...', sub: file.name });
      try {
        const name = file.name.toLowerCase();
        let csvText: string;

        if (name.endsWith('.zip')) {
          const { default: JSZip } = await import('jszip');
          const zip = await JSZip.loadAsync(file);
          const entry = Object.values(zip.files).find((f) => f.name.endsWith('.csv'));
          if (!entry) throw new Error('Không tìm thấy file CSV trong zip');
          setLoading({ show: true, text: 'Đang giải nén...', sub: '' });
          csvText = await entry.async('string');
        } else if (name.endsWith('.csv')) {
          csvText = await file.text();
        } else {
          throw new Error('Chỉ hỗ trợ .zip hoặc .csv');
        }

        await applyTrades(csvText, file.name);
      } catch (e: unknown) {
        setLoading({ show: false, text: '', sub: '' });
        showToast('Lỗi: ' + (e instanceof Error ? e.message : String(e)), 'err');
      }
    },
    [applyTrades, showToast],
  );

  const fetchURL = useCallback(
    async (url: string, hideSub?: boolean) => {
      if (!url) { showToast('Nhập URL trước!', 'err'); return; }
      setLoading({ show: true, text: 'Đang tải từ URL...', sub: hideSub ? '' : url.slice(-60) });
      try {
        // Bybit has no CORS headers — route through server-side proxy.
        // Binance data.binance.vision has CORS(*), fetch directly.
        const isBybit = url.includes('bybit.com');
        const fetchTarget = isBybit ? `/api/proxy?url=${encodeURIComponent(url)}` : url;
        const res = await fetch(fetchTarget);
        if (res.status === 404) throw new Error('404_NOT_FOUND');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();

        let csvText: string;
        if (url.endsWith('.csv.gz')) {
          // Bybit: decompress gzip with browser native DecompressionStream
          setLoading({ show: true, text: 'Đang giải nén gzip...', sub: '' });
          const ds = new DecompressionStream('gzip');
          const writer = ds.writable.getWriter();
          writer.write(new Uint8Array(buf));
          writer.close();
          const out = await new Response(ds.readable).arrayBuffer();
          csvText = new TextDecoder().decode(out);
        } else {
          // Binance: .zip
          const { default: JSZip } = await import('jszip');
          const zip = await JSZip.loadAsync(buf);
          const entry = Object.values(zip.files).find((f) => f.name.endsWith('.csv'));
          if (!entry) throw new Error('Không có CSV trong zip');
          setLoading({ show: true, text: 'Đang giải nén...', sub: '' });
          csvText = await entry.async('string');
        }

        await applyTrades(csvText, url);
      } catch (e: unknown) {
        setLoading({ show: false, text: '', sub: '' });
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === '404_NOT_FOUND') {
          const isFutures = url.includes('/futures/');
          showToast(
            isFutures
              ? 'File không tồn tại (404). Symbol này có thể không có hợp đồng Futures — thử chọn Spot.'
              : 'File không tồn tại (404). Kiểm tra lại symbol và ngày.',
            'err',
          );
        } else {
          showToast('Lỗi: ' + msg, 'err');
        }
      }
    },
    [applyTrades, showToast],
  );

  return { tradeFile, loading, toast, startDt, setStartDt, endDt, setEndDt, loadFile, fetchURL, showToast };
}
