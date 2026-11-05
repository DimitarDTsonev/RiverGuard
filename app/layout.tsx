import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RiverGuard България · Речен мониторинг",
  description: "Примерна национална платформа за речни станции, измервания, общинско управление и координация.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="bg">
      <body className="antialiased">{children}</body>
    </html>
  );
}
