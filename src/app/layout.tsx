import type { Metadata } from "next";
import Script from "next/script";
import { ReactGrabDev } from "@/components/react-grab-dev";
import { FeedbackWidget } from "@/components/feedback-widget";
import { Notifications } from "@/components/notifications";
import { ThemeToggle } from "@/components/theme-toggle";
import { SessionCacheBoundary } from "@/components/session-cache-boundary";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import "./workspace.css";

const inter = Inter({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-ui" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-reading" });

export const metadata: Metadata = {
  title: { default: "paperflow — Read research beautifully", template: "%s · paperflow" },
  description: "Turn research papers into calm, accessible reading experiences.",
};

const themeScript = `(() => { let theme = 'light'; try { const saved = localStorage.getItem('paperflow-theme') ?? localStorage.getItem('rpaper-theme'); if (saved === 'dark' || saved === 'light') theme = saved; } catch {} document.documentElement.dataset.theme = theme; })();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning data-scroll-behavior="smooth">
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
      <body className={`${inter.variable} ${sourceSerif.variable}`}>{process.env.NODE_ENV === "development" && <ReactGrabDev />}<SessionCacheBoundary /><Notifications /><FeedbackWidget />{children}<div className="global-theme-control"><ThemeToggle /></div></body>
    </html>
  );
}
