export interface Trade {
  time: number;  // ms UTC timestamp
  price: number;
  qty: number;
  isBuyerMaker?: boolean; // true = buyer is maker = sell trade; false = buyer is taker = buy trade
}

export interface OrderPanelHandle {
  notifyPrice: (price: number, decimals: number, replayTimeMs: number) => void;
  reset: () => void;
  openOrder: (side: 'long' | 'short', usdt: number) => void;
  placeLimitOrder: (side: 'long' | 'short', limitPrice: number, usdt: number) => void;
}

export interface CandleData {
  time: number; // UTCTimestamp (seconds), already shifted +7h for display
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface VolumeData {
  time: number;
  value: number;
  color: string;
}

export type MarketType = 'spot' | 'futures/um';
export type ReplayStatus = 'idle' | 'playing' | 'paused' | 'done';

export interface TradeFile {
  symbol: string;
  tradeDay: string;
  trades: Trade[];
  autoDecimals: number;
}
