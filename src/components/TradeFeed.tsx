'use client';
import { forwardRef } from 'react';
import styles from './TradeFeed.module.css';

const TradeFeed = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div className={styles.wrap}>
      <div className={styles.colHead}>
        <span className={styles.colPrice}>Giá</span>
        <span className={styles.colQty}>Vol</span>
        <span className={styles.colTime}>Giờ</span>
      </div>
      {/* Content injected by useReplay via DOM */}
      <div className={styles.list} ref={ref} />
    </div>
  );
});
TradeFeed.displayName = 'TradeFeed';
export default TradeFeed;
