'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { CandleData, VolumeData } from '@/types';
import type { ChartHandle, ChartMarker } from '@/hooks/useReplay';
import type { IChartApi, ISeriesApi, IPriceLine } from 'lightweight-charts';
import styles from './ChartPanel.module.css';

const ChartPanel = forwardRef<ChartHandle>(function ChartPanel(_props, ref) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const tooltipRef    = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<IChartApi | null>(null);
  const candleRef     = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef     = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLinesRef = useRef<Map<number, IPriceLine>>(new Map());
  const lastCloseRef  = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    let chart: IChartApi;
    let destroyed = false;

    // Lazy-load lightweight-charts (browser only)
    import('lightweight-charts').then(({ createChart, CrosshairMode }) => {
      if (destroyed || !containerRef.current) return;

      const w = containerRef.current.clientWidth  || 800;
      const h = containerRef.current.clientHeight || 500;

      chart = createChart(containerRef.current, {
        layout: {
          background: { color: '#0d1117' },
          textColor: '#7d8590',
        },
        grid: {
          vertLines: { color: '#161b22' },
          horzLines: { color: '#161b22' },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#21262d' },
        timeScale: { borderColor: '#21262d', timeVisible: true, secondsVisible: false },
        width:  w,
        height: h,
      });

      const cSeries = chart.addCandlestickSeries({
        upColor: '#26a69a', downColor: '#ef5350',
        borderUpColor: '#26a69a', borderDownColor: '#ef5350',
        wickUpColor: '#26a69a', wickDownColor: '#ef5350',
        priceFormat: { type: 'price', precision: 6, minMove: 0.000001 },
      });

      const vSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      });
      chart.priceScale('vol').applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
        visible: false,
      });
      // Large margins so candles only occupy the middle ~40% of chart height
      // (30% empty above, 30% empty below) — volume has its own scale so no conflict
      chart.priceScale('right').applyOptions({
        visible: true,
        borderColor: '#21262d',
        scaleMargins: { top: 0.3, bottom: 0.3 },
      });

      chartRef.current  = chart;
      candleRef.current = cSeries;
      volumeRef.current = vSeries;
      priceLinesRef.current.clear();

      // Crosshair tooltip showing price diff vs current price
      chart.subscribeCrosshairMove((param) => {
        const tip = tooltipRef.current;
        if (!tip) return;
        if (!param.point) { tip.style.display = 'none'; return; }
        // Use the actual y-coordinate → price (mouse position, not candle close)
        const crossPrice = cSeries.coordinateToPrice(param.point.y);
        if (crossPrice == null) { tip.style.display = 'none'; return; }
        const last = lastCloseRef.current;
        if (!last) { tip.style.display = 'none'; return; }
        const diff = crossPrice - last;
        const pct  = (diff / last) * 100;
        const dec  = crossPrice < 0.001 ? 6 : crossPrice < 1 ? 5 : crossPrice < 100 ? 4 : 2;
        const sign = diff >= 0 ? '+' : '';
        const color = diff >= 0 ? '#26a69a' : '#ef5350';
        tip.innerHTML =
          `<span style="color:var(--text)">${crossPrice.toFixed(dec)}</span>` +
          `<span style="color:${color};margin-left:6px">${sign}${pct.toFixed(2)}%</span>`;
        // Position near crosshair but keep inside container
        const x = param.point.x;
        const w = containerRef.current?.clientWidth ?? 800;
        tip.style.display = 'flex';
        tip.style.left = x > w - 160 ? `${x - 150}px` : `${x + 12}px`;
        tip.style.top  = `${Math.max(4, (param.point.y ?? 0) - 14)}px`;
      });
    });

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width:  containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      destroyed = true;
      ro.disconnect();
      chart?.remove();
      chartRef.current  = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    updateCandle(c: CandleData) {
      lastCloseRef.current = c.close;
      candleRef.current?.update(c);
    },
    updateVolume(v: VolumeData) {
      volumeRef.current?.update(v);
    },
    setData(candles: CandleData[], volumes: VolumeData[]) {
      if (candles.length) lastCloseRef.current = candles[candles.length - 1].close;
      candleRef.current?.setData(candles);
      volumeRef.current?.setData(volumes);
    },
    clear() {
      candleRef.current?.setData([]);
      volumeRef.current?.setData([]);
    },
    setPriceDecimals(decimals: number) {
      const minMove = Math.pow(10, -decimals);
      candleRef.current?.applyOptions({
        priceFormat: { type: 'price', precision: decimals, minMove },
      });
    },
    fitContent() {
      chartRef.current?.timeScale().fitContent();
    },
    setMarkers(markers: ChartMarker[]) {
      if (!candleRef.current) return;
      const UTC7_S = 7 * 3600;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lc: any[] = markers.map(m => ({
        time: Math.floor(m.timeMs / 1000) + UTC7_S,
        position: m.position ?? 'aboveBar',
        color: m.color,
        shape: 'arrowDown',
        text: m.label,
        size: 2,
      }));
      lc.sort((a, b) => a.time - b.time);
      try { candleRef.current.setMarkers(lc); } catch { /**/ }
    },
    addPriceLine(id: number, price: number, color: string, title: string) {
      if (!candleRef.current) return;
      // Remove existing line for this id first
      const existing = priceLinesRef.current.get(id);
      if (existing) { try { candleRef.current.removePriceLine(existing); } catch { /**/ } }
      const line = candleRef.current.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title,
      });
      priceLinesRef.current.set(id, line);
    },
    removePriceLine(id: number) {
      const line = priceLinesRef.current.get(id);
      if (line && candleRef.current) {
        try { candleRef.current.removePriceLine(line); } catch { /**/ }
        priceLinesRef.current.delete(id);
      }
    },
  }));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} className={styles.chartContainer} />
      <div ref={tooltipRef} className={styles.crosshairTooltip} />
    </div>
  );
});

ChartPanel.displayName = 'ChartPanel';
export default ChartPanel;
