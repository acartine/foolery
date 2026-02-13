import type { Metadata } from "next";
import { Manrope, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/app-header";
import { TerminalPanel } from "@/components/terminal-panel";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600", "700"],
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
        className={`${manrope.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable} antialiased`}
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
