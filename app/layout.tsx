import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { siteOrigin } from "./lib/site-origin";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const origin = siteOrigin();
const title = "Der Die Das Sprint — German articles at speed";
const description = "Fast, keyboard-first German article practice with progress saved on your device.";

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title,
  description,
  applicationName: "Der Die Das Sprint",
  alternates: { canonical: "/" },
  openGraph: { title, description, type: "website", url: origin, siteName: "Der Die Das Sprint", locale: "de_DE", images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "Der Die Das Sprint — Deutsch. Schnell. Sicher." }] },
  twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
};

const themeScript = `(() => { try { const raw = localStorage.getItem("ddd-sprint:v1"); const saved = raw ? JSON.parse(raw).theme : null; const theme = saved === "dark" || saved === "light" ? saved : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); document.documentElement.dataset.theme = theme; } catch { document.documentElement.dataset.theme = "light"; } })();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="shortcut icon" href="/favicon.svg" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* Cloudflare Web Analytics: cookiefrei, misst nur Seitenaufrufe. Der Token ist öffentlich. */}
        <script defer type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "51c2ec958a6146d995055263ecf49992"}' />
      </head>
      <body
        className={geistSans.variable}
      >
        {children}
      </body>
    </html>
  );
}
