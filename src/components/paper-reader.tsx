/* eslint-disable @next/next/no-img-element */
import katex from "katex";
import { ArrowLeft, BookOpenText, ExternalLink, FileDown } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";
import { ReaderProgress } from "./reader-progress";
import type { DocumentNode, HeadingNode, PaperDocument } from "@/lib/types/document";

type OutlineHeading = HeadingNode & {
  displayLevel: 1 | 2 | 3 | 4;
  sectionNumber?: string;
  label: string;
};

export function PaperReader({ paper, backHref = "/library", originalUrl }: { paper: PaperDocument; backHref?: string; originalUrl?: string }) {
  const headings = buildHeadingOutline(paper.sections.filter((node): node is HeadingNode => node.type === "heading"));
  const headingById = new Map(headings.map((heading) => [heading.id, heading]));
  return <main className="reader-page"><ReaderProgress /><header className="reader-header"><Link href={backHref} className="reader-back" aria-label="Back"><ArrowLeft size={19} /></Link><span className="reader-brand"><BookOpenText size={18} />Rpaper</span><div className="reader-tools">{originalUrl && <a className="reader-tool" href={originalUrl} target="_blank" rel="noreferrer"><FileDown size={16} />Original</a>}<ThemeToggle /></div></header><div className="reader-layout"><aside className="reader-toc"><div className="reader-toc-heading"><span>Contents</span><small>{headings.length} sections</small></div><nav aria-label="Document contents">{headings.map((heading) => <a key={heading.id} className={`toc-level-${heading.displayLevel}`} href={`#${heading.id}`}>{heading.sectionNumber && <span className="toc-number">{heading.sectionNumber}</span>}<span className="toc-text">{heading.label}</span></a>)}</nav></aside><article className="paper-article"><header className="paper-title-block"><span className="paper-type">Research paper · {paper.source.type.toUpperCase()}</span><h1>{paper.metadata.title}</h1><p className="paper-byline">{paper.metadata.authors.join(" · ")}</p>{paper.metadata.publishedAt && <p className="paper-date">Published {paper.metadata.publishedAt}{paper.metadata.pageCount ? ` · ${paper.metadata.pageCount} pages` : ""}</p>}</header>{paper.metadata.abstract && <section className="abstract-block"><h2>Abstract</h2><p>{paper.metadata.abstract}</p></section>}<div className="paper-content">{paper.sections.map((node) => <DocumentBlock key={node.id} node={node} heading={node.type === "heading" ? headingById.get(node.id) : undefined} />)}</div>{paper.references.length > 0 && <section className="references" id="references"><h2>References</h2><ol>{paper.references.map((reference, index) => <li key={`${index}-${reference.slice(0, 20)}`}>{reference}</li>)}</ol></section>}<footer className="paper-end"><span /><p>End of paper</p><Link href={backHref}>Return to your library</Link></footer></article></div></main>;
}

function DocumentBlock({ node, heading }: { node: DocumentNode; heading?: OutlineHeading }) {
  switch (node.type) {
    case "heading": {
      const display = heading ?? toOutlineHeading(node, node.level);
      const Tag = `h${Math.min(5, display.displayLevel + 1)}` as "h2" | "h3" | "h4" | "h5";
      return <Tag id={node.id} className={`paper-heading paper-heading-level-${display.displayLevel}`}>{display.sectionNumber && <span className="paper-section-number">{display.sectionNumber}</span>}<span>{display.label}</span></Tag>;
    }
    case "paragraph": return <p className="paper-paragraph">{node.text}</p>;
    case "list": {
      const Tag = node.ordered ? "ol" : "ul";
      return <Tag className="paper-list">{node.items.map((item, index) => <li key={`${index}-${item.slice(0, 16)}`}>{item}</li>)}</Tag>;
    }
    case "formula": return <Formula node={node} />;
    case "table": return <figure className="paper-table"><div className="table-scroll"><table><thead><tr>{node.headers.map((header, index) => <th key={`${index}-${header}`}>{header}</th>)}</tr></thead><tbody>{node.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>{node.caption && <figcaption>{node.caption}</figcaption>}</figure>;
    case "figure": return <figure className="paper-figure"><a href={safeUrl(node.assetUrl)} target="_blank" rel="noreferrer">{/* Signed private assets cannot use the build-time Next image optimizer. */}<img src={safeUrl(node.assetUrl)} alt={node.alt} /><span><ExternalLink size={14} />Open full size</span></a>{node.caption && <figcaption>{node.caption}</figcaption>}</figure>;
    case "code": return <pre className="paper-code"><code>{node.code}</code></pre>;
    case "footnote": return <aside className="paper-footnote"><sup>{node.label}</sup>{node.text}</aside>;
  }
}

export function buildHeadingOutline(headings: HeadingNode[]): OutlineHeading[] {
  const numberedTopLevelCount = headings.filter((heading) => parseHeadingNumber(heading.text)?.level === 1).length;
  const useNumberedFallback = numberedTopLevelCount >= 3 && headings.every((heading) => heading.level === 1);
  let insideNumberedSection = false;

  return headings.map((heading) => {
    const parsed = parseHeadingNumber(heading.text);
    if (parsed) insideNumberedSection = true;
    const level = parsed?.level ?? (useNumberedFallback && insideNumberedSection ? 2 : heading.level);
    return toOutlineHeading(heading, level, parsed);
  });
}

function toOutlineHeading(
  heading: HeadingNode,
  level: number,
  parsed = parseHeadingNumber(heading.text),
): OutlineHeading {
  return {
    ...heading,
    displayLevel: Math.max(1, Math.min(4, level)) as OutlineHeading["displayLevel"],
    sectionNumber: parsed?.number,
    label: parsed?.label ?? heading.text,
  };
}

function parseHeadingNumber(text: string) {
  const match = text.trim().match(/^(\d+(?:\.\d+)*)(?:[.)])?\s+(.+)$/);
  if (!match) return null;
  return { number: match[1], label: match[2], level: match[1].split(".").length };
}

function Formula({ node }: { node: Extract<DocumentNode, { type: "formula" }> }) {
  const html = renderFormula(node.latex);
  if (html === null) return <figure className="paper-formula formula-fallback"><code>{node.latex}</code>{node.label && <figcaption>{node.label}</figcaption>}</figure>;
  return <figure className="paper-formula"><div dangerouslySetInnerHTML={{ __html: html }} />{node.label && <figcaption>{node.label}</figcaption>}</figure>;
}

function renderFormula(latex: string) {
  try {
    return katex.renderToString(latex, { displayMode: true, throwOnError: true, trust: false, strict: "error", output: "htmlAndMathml" });
  } catch {
    return null;
  }
}

export function safeUrl(url: string) {
  if (url.startsWith("/") || url.startsWith("https://") || url.startsWith("http://localhost:")) return url;
  return "#";
}
