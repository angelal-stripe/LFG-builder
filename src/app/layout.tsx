import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LFG sticker builder",
  description: "Compose a 100×100 animated LFG sticker GIF",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
