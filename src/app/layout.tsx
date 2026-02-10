import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { RepoSwitcher } from "@/components/repo-switcher";
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
          <header className="border-b">
            <div className="container mx-auto flex h-14 items-center justify-between px-4 max-w-7xl">
              <Link href="/beads" className="flex items-center">
                <Image src="/foolery_icon.png" alt="Foolery" width={48} height={48} unoptimized className="rounded" />
              </Link>
              <RepoSwitcher />
            </div>
          </header>
          {children}
        </Providers>
      </body>
    </html>
  );
}
