import type { ReactNode } from "react";
import { renderMath } from "@/lib/render-math";

export function equationSourceUrl(url?: string) {
  return url && (url.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url) || url.startsWith("/api/")) ? url : undefined;
}

// Successful typesetting is not verification of OCR accuracy. Keep the source
// available and leave the manifest's candidate/verified fields unchanged.
export function ExtractedEquation({ latex, inline = false, sourceUrl, children }: {
  latex?: string; inline?: boolean; sourceUrl?: string; children: ReactNode;
}) {
  const html = latex?.trim() ? renderMath(latex, !inline) : null;
  if (html === null) return children;
  const url = equationSourceUrl(sourceUrl);
  if (inline) return <span className="paper-extracted-inline">
    <span className="paper-extracted-math" dangerouslySetInnerHTML={{ __html: html }} />
    {url && <a className="paper-equation-original" href={url} target="_blank" rel="noreferrer" aria-label="View original equation" title="Compare with the original equation"><span aria-hidden="true">↗</span></a>}
  </span>;
  return <div className="paper-extracted-equation">
    <div className="paper-extracted-display" tabIndex={0} role="region" aria-label="Equation" dangerouslySetInnerHTML={{ __html: html }} />
    <details className="paper-equation-source"><summary>Original equation</summary><div>{children}</div></details>
  </div>;
}
