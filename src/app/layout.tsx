import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { RepoSwitcher } from "@/components/repo-switcher";
import { SearchBar } from "@/components/search-bar";
import Link from "next/link";
import Image from "next/image";
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
          <header>
            <div className="mx-auto flex items-center justify-between px-4 py-2 max-w-[95vw]">
              <div className="flex items-center flex-1 min-w-0">
                <Link href="/beads" className="flex items-center shrink-0">
                  <Image src="/foolery_icon.png" alt="Foolery" width={54} height={54} unoptimized className="rounded-lg" />
                </Link>
                <SearchBar />
              </div>
              <div className="shrink-0 ml-4">
                <RepoSwitcher />
              </div>
            </div>
          </header>
          {children}
        </Providers>
      </body>
    </html>
  );
}
