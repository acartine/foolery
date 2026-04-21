import type { Metadata } from "next";
import { Manrope, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/app-header";
import { ClientPerfRouteObserver } from "@/components/client-perf-route-observer";
import { TerminalPanel } from "@/components/terminal-panel";
import { TerminalConnectionSync } from "@/components/terminal-connection-sync";
import { UrlStateSync } from "@/components/url-state-sync";
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
  title: "Foolery",
  description: "View and manage beats",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${manrope.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable}`}>
      <head>
        {/* Flash-free theme init: mirror the `theme` localStorage choice onto
            `<html>` before first paint so dark-mode surfaces never flash light.
            Default ("system") honors prefers-color-scheme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { var t = localStorage.getItem("theme"); var d = t === "dark" || ((t === null || t === "system") && window.matchMedia("(prefers-color-scheme: dark)").matches); if (d) document.documentElement.classList.add("dark"); } catch (_) {} })();`,
          }}
        />
      </head>
      <body
        className="antialiased"
      >
        <Providers>
          <Suspense fallback={null}>
            <AppHeader />
            <ClientPerfRouteObserver />
            <UrlStateSync />
          </Suspense>
          {children}
          <TerminalConnectionSync />
          <TerminalPanel />
        </Providers>
      </body>
    </html>
  );
}
