import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/app-header";
import { TerminalPanel } from "@/components/terminal-panel";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Foolery — Beads Viewer",
  description: "View and manage Beads issues",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <Suspense fallback={null}>
            <AppHeader />
          </Suspense>
          {children}
          <TerminalPanel />
        </Providers>
      </body>
    </html>
  );
}
