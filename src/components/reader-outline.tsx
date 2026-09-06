"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ListTree } from "lucide-react";
export type ReaderHeading = { id: string; label: string; sectionNumber?: string; displayLevel: number };
export function ReaderOutline({ headings }: { headings: ReaderHeading[] }) {
  const [active, setActive] = useState(headings[0]?.id ?? "");
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const positions = new Map<string, number>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) { if (entry.isIntersecting) positions.set(entry.target.id, entry.boundingClientRect.top); else positions.delete(entry.target.id); }
      const current = [...positions].sort((a, b) => a[1] - b[1])[0];
      if (current) setActive(current[0]);
    }, { rootMargin: "-80px 0px -55% 0px" });
    for (const heading of headings) { const element = document.getElementById(heading.id); if (element) observer.observe(element); }
    return () => observer.disconnect();
  }, [headings]);
  const links = headings.map(heading => <a key={heading.id} className={`toc-level-${heading.displayLevel}`} aria-current={active === heading.id ? "location" : undefined} href={`#${heading.id}`} onClick={() => { setActive(heading.id); if (details.current) details.current.open = false; }}>{heading.sectionNumber && <span className="toc-number">{heading.sectionNumber}</span>}<span className="toc-text">{heading.label}</span></a>);
  return <><aside className="reader-toc"><div className="reader-toc-heading"><span><ListTree size={16} /> Contents</span><small>{headings.length}</small></div><nav aria-label="Document contents">{links}</nav><p className="toc-footer">Keep your place.<br />Follow the paper’s structure.</p></aside><details className="mobile-outline" ref={details}><summary><ListTree size={16} /><span>Contents</span><ChevronDown size={16} /></summary><nav aria-label="Mobile document contents">{links}</nav></details></>;
}
