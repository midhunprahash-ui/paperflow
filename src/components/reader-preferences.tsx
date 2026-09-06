"use client";
import { useState } from "react";
export function ReaderPreferences() {
  const [size, setSize] = useState("standard");
  return <details className="reader-preferences"><summary aria-label="Reading settings">Aa</summary><div className="reader-preferences-panel"><span>Text size</span><div role="group" aria-label="Reader text size">{["standard", "large"].map(value => <button key={value} aria-pressed={size === value} onClick={event => { setSize(value); const reader = event.currentTarget.closest<HTMLElement>(".reader-page"); if (reader) reader.dataset.textSize = value; }}>{value === "standard" ? "Standard" : "Large"}</button>)}</div><p>Source images keep their original formatting.</p></div></details>;
}
