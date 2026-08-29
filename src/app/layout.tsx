import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-ui" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], variable: "--font-reading" });

export const metadata: Metadata = {
  title: { default: "Rpaper — Read research beautifully", template: "%s · Rpaper" },
  description: "Turn research papers into calm, accessible reading experiences.",
};

const themeScript = `(() => { try { const saved = localStorage.getItem('rpaper-theme'); const dark = saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; } catch {} })();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className={`${inter.variable} ${sourceSerif.variable}`}>{children}</body>
    </html>
  );
}
