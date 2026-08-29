"use client";

import { RotateCcw } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="not-found"><h1>Something went wrong.</h1><p>Your documents are safe. Reload this view and try again.</p><button className="button button-primary" type="button" onClick={reset}><RotateCcw size={17} />Try again</button></main>;
}
