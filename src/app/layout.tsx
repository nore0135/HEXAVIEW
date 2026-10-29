import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title: "HexaView | Market workspace", description: "Real-time BTC/USDT charting workspace"};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
 return <html lang="en"><body>{children}</body></html>;
}
