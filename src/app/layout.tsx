import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trade Replay — Binance aggTrades',
  description: 'Tái tạo nến từ raw aggTrades data · pure client-side',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
