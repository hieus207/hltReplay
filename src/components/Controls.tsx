'use client';

import { useState } from 'react';
import type { ReplayStatus } from '@/types';
import { fmtUTC7 } from '@/lib/format';
import styles from './Controls.module.css';

const SPEED_PRESETS = [1, 2, 5, 10, 20, 60, 120, 300];

interface ProgressMarker {
  ratio: number;   // 0–1 position on bar
  label: string;
  color: string;
}

const STATUS_LABELS: Record<ReplayStatus, string> = {
  idle:    'Chưa load data',
  playing: 'Playing...',
  paused:  'Paused',
  done:    'Replay hoàn tất ✓',
};

interface Props {
  status: ReplayStatus;
  speed: number;
  startMs: number;
  endMs: number;
  // DOM refs (managed by parent) for high-frequency direct DOM updates
  progFillRef: React.RefObject<HTMLDivElement | null>;
  progHeadRef: React.RefObject<HTMLDivElement | null>;
  timeDisplayRef: React.RefObject<HTMLSpanElement | null>;
  markers?: ProgressMarker[];
  onTogglePlay: () => void;
  onStop: () => void;
  onSetSpeed: (s: number) => void;
  onSeek: (ratio: number) => void;
  onSeekBy: (deltaMs: number) => void;
  onFitContent: () => void;
}

export default function Controls({
  status, speed, startMs, endMs,
  progFillRef, progHeadRef, timeDisplayRef,
  markers,
  onTogglePlay, onStop, onSetSpeed, onSeek, onSeekBy, onFitContent,
}: Props) {
  const isPlaying = status === 'playing';
  const [customVal, setCustomVal] = useState('');
  const [skipSec, setSkipSec] = useState(30);

  const handleCustomKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const v = parseInt(customVal, 10);
    if (!isNaN(v) && v >= 1 && v <= 100000) {
      onSetSpeed(v);
      setCustomVal('');
    }
  };

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio);
  };

  return (
    <div className={styles.controls}>
      {/* Progress row */}
      <div className={styles.progressRow}>
        <span className={styles.timeLabel}>
          {startMs ? fmtUTC7(startMs) : '—'}
        </span>

        <div className={styles.progBar} onClick={handleBarClick}>
          <div className={styles.progFill} ref={progFillRef as React.RefObject<HTMLDivElement>} />
          <div className={styles.progHead} ref={progHeadRef as React.RefObject<HTMLDivElement>} />
          {markers?.map((m, i) => (
            <div
              key={i}
              className={styles.markerPin}
              style={{ left: `${m.ratio * 100}%`, borderColor: m.color }}
            >
              <span className={styles.markerLabel} style={{ color: m.color }}>{m.label}</span>
            </div>
          ))}
        </div>

        <span className={styles.timeLabel} style={{ textAlign: 'right' }}>
          {endMs ? fmtUTC7(endMs) : '—'}
        </span>
      </div>

      {/* Control row */}
      <div className={styles.ctrlRow}>
        <button className={styles.ctrlBtn} onClick={onStop} title="Stop & Reset">⏹</button>

        {/* Skip back / forward */}
        <button
          className={styles.ctrlBtn}
          onClick={() => onSeekBy(-skipSec * 1000)}
          disabled={status === 'idle'}
          title={`Tua lùi ${skipSec}s`}
        >
          ◀◀
        </button>
        <button
          className={`${styles.ctrlBtn} ${isPlaying ? styles.playActive : ''}`}
          onClick={onTogglePlay}
          title="Play / Pause"
          disabled={status === 'idle'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className={styles.ctrlBtn}
          onClick={() => onSeekBy(skipSec * 1000)}
          disabled={status === 'idle'}
          title={`Tua tới ${skipSec}s`}
        >
          ▶▶
        </button>

        {/* Skip seconds input */}
        <div className={styles.skipWrap}>
          <input
            className={styles.skipInp}
            type="number"
            min={1}
            max={86400}
            value={skipSec}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 1) setSkipSec(v);
            }}
            title="Số giây mỗi lần tua"
          />
          <span className={styles.skipLabel}>s</span>
        </div>
        <button
          className={styles.ctrlBtn}
          onClick={onFitContent}
          title="Vừa khịp tất cả nẽn (fit)"
          style={{ fontSize: 12, letterSpacing: '-1px' }}
        >
          ⛶
        </button>

        <div className={styles.speedGroup}>
          {SPEED_PRESETS.map((s) => (
            <button
              key={s}
              className={`${styles.spBtn} ${speed === s ? styles.spActive : ''}`}
              onClick={() => onSetSpeed(s)}
            >
              {s}×
            </button>
          ))}
          <div className={styles.customWrap}>
            <input
              className={styles.customInp}
              type="number"
              min={1}
              max={100000}
              placeholder="custom×"
              value={customVal}
              onChange={(e) => setCustomVal(e.target.value)}
              onKeyDown={handleCustomKey}
              title="Nhập tốc độ tuỳ chỉnh rồi nhấn Enter"
            />
            {!SPEED_PRESETS.includes(speed) && (
              <span className={styles.spActive} style={{ padding: '3px 7px', borderRadius: 4, fontSize: 11, border: '1px solid var(--accent)' }}>
                {speed}×
              </span>
            )}
          </div>
        </div>

        <span className={styles.currentTime} ref={timeDisplayRef as React.RefObject<HTMLSpanElement>} />

        <span className={`${styles.statusPill} ${styles[`status_${status}`]}`}>
          {STATUS_LABELS[status]}
        </span>
      </div>
    </div>
  );
}
