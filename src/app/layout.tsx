import type { Metadata } from "next";
import Script from "next/script";
import { ThemeToggle } from "@/components/theme-toggle";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import "./workspace.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-ui" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], variable: "--font-reading" });

export const metadata: Metadata = {
  title: { default: "paperflow — Read research beautifully", template: "%s · paperflow" },
  description: "Turn research papers into calm, accessible reading experiences.",
};

const themeScript = `(() => { try { const saved = localStorage.getItem('paperflow-theme') ?? localStorage.getItem('rpaper-theme'); const dark = saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; } catch {} })();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="https://unpkg.com/react-grab@0.2.0/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} ${sourceSerif.variable}`}>{children}<div className="global-theme-control"><ThemeToggle /></div></body>
    </html>
  );
}
