import "katex/dist/katex.min.css";
/* eslint-disable @next/next/no-img-element */
import katex from "katex";
import { ReaderOutline } from "./reader-outline";
import { ReaderPreferences } from "./reader-preferences";
import { InlineContent, SourceImage, StructuredTable } from "./structured-content";
import { ArrowLeft, ExternalLink, FileDown } from "lucide-react";
import Link from "next/link";
import { ReaderProgress } from "./reader-progress";
import type { DocumentNode, HeadingNode, PaperDocument, PaperAsset } from "@/lib/types/document";

type OutlineHeading = HeadingNode & {
  displayLevel: number;
  sectionNumber?: string;
  label: string;
};

export function PaperReader({ paper, backHref = "/library", originalUrl }: { paper: PaperDocument; backHref?: string; originalUrl?: string }) {
  const headings = buildHeadingOutline(paper.sections.filter((node): node is HeadingNode => node.type === "heading"));
  const headingById = new Map(headings.map((heading) => [heading.id, heading]));
  return <main className="reader-page"><ReaderProgress />
    <header className="reader-header"><Link href={backHref} prefetch={true} className="reader-back" aria-label="Back to library"><ArrowLeft size={18} /><span>Library</span></Link><div className="reader-document-label"><span>{paper.metadata.title}</span></div><div className="reader-tools"><ReaderPreferences />{originalUrl && <a className="reader-tool" href={originalUrl} target="_blank" rel="noreferrer"><FileDown size={16} /><span>Original PDF</span></a>}</div></header>
    <div className="reader-layout"><ReaderOutline headings={headings.map(({ id, label, sectionNumber, displayLevel }) => ({ id, label, sectionNumber, displayLevel }))} />
      <article className="paper-article"><header className="paper-title-block"><div className="paper-reading-meta"><span className="paper-type">Research paper</span><span>{paper.source.type.toUpperCase()}{paper.metadata.pageCount ? ` · ${paper.metadata.pageCount} pages` : ""}</span></div><h1>{paper.metadata.title}</h1>{paper.metadata.authors.length > 0 && <p className="paper-byline">{paper.metadata.authors.join(" · ")}</p>}{paper.metadata.publishedAt && <p className="paper-date">{paper.metadata.publishedAt}</p>}<div className="paper-title-rule" /></header>
        {paper.metadata.abstract && <section className="abstract-block"><h2>Abstract</h2><p>{paper.metadata.abstract}</p></section>}
        <div className="paper-content">{paper.sections.map(node => <div key={node.id} id={node.type === "heading" ? undefined : node.id} data-source-id={node.sourceId} data-section-id={node.sectionId}><DocumentBlock node={node} assets={paper.assets ?? {}} heading={node.type === "heading" ? headingById.get(node.id) : undefined} /></div>)}</div>
        {paper.references.length > 0 && <section className="references" id="references"><h2>References</h2><ol>{paper.references.map((reference, index) => <li key={`${index}-${reference.slice(0, 20)}`}>{reference}</li>)}</ol></section>}
        <footer className="paper-end"><span /><p>End of paper</p><Link href={backHref} prefetch={true}>Return to your library</Link></footer>
      </article>
    </div>
  </main>;
}

function DocumentBlock({ node, heading, assets }: { node: DocumentNode; heading?: OutlineHeading; assets: Record<string, PaperAsset> }) {
  if (node.role === "title") return null;
  if (node.sourceFragments?.length) return <div className="paper-source-paragraph">{node.sourceFragments.map((fragment, i) => <SourceImage key={i} asset={fragment.asset} widthEm={fragment.widthEm} assets={assets} alt={"text" in node ? `Original paragraph; unverified text: ${node.text}` : "Original paragraph"} />)}</div>;
  if (node.sourceAsset && node.type !== "figure") return <figure className="paper-formula"><SourceImage asset={node.sourceAsset} assets={assets} alt="Original equation" /></figure>;
  switch (node.type) {
    case "heading": {
      const display = heading ?? toOutlineHeading(node, node.level);
      const Tag = `h${Math.min(6, display.displayLevel + 1)}` as "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag id={node.id} className={`paper-heading paper-heading-level-${display.displayLevel}`}>{display.sectionNumber && <span className="paper-section-number">{display.sectionNumber}</span>}<span>{display.label}</span></Tag>;
    }
    case "paragraph": return <p className="paper-paragraph">{node.inline ? <InlineContent parts={node.inline} assets={assets} /> : node.text}</p>;
    case "list_item": return <div className="paper-source-list-item" data-list-id={node.listId}><span className="paper-list-marker">{node.marker}</span><span>{node.text}</span></div>;
    case "caption": return <p className="paper-source-caption" data-caption-of={node.captionOf}>{node.text}</p>;
    case "list": {
      const Tag = node.ordered ? "ol" : "ul";
      return <Tag className="paper-list">{node.items.map((item, index) => <li key={`${index}-${item.slice(0, 16)}`}>{item}</li>)}</Tag>;
    }
    case "formula": return <Formula node={node} />;
    case "table": if (node.cells) return <StructuredTable node={node} assets={assets} />; return <figure className="paper-table"><div className="table-scroll"><table><thead><tr>{node.headers.map((header, index) => <th key={`${index}-${header}`}>{header}</th>)}</tr></thead><tbody>{node.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>{node.caption && <figcaption>{node.caption}</figcaption>}</figure>;
    case "figure": if (node.sourceAsset) return <figure className="paper-figure"><SourceImage asset={node.sourceAsset} assets={assets} alt={node.alt} /></figure>; return <figure className="paper-figure"><a href={safeUrl(node.assetUrl)} target="_blank" rel="noreferrer">{/* Signed private assets cannot use the build-time Next image optimizer. */}<img loading="lazy" decoding="async" src={safeUrl(node.assetUrl)} alt={node.alt} /><span><ExternalLink size={14} />Open full size</span></a>{node.caption && <figcaption>{node.caption}</figcaption>}</figure>;
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
    const level = heading.explicitHierarchy ? heading.level : parsed?.level ?? (useNumberedFallback && insideNumberedSection ? 2 : heading.level);
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
    displayLevel: Math.max(1, Math.min(6, level)) as OutlineHeading["displayLevel"],
    sectionNumber: parsed?.number,
    label: heading.explicitHierarchy ? (parsed?.label ?? heading.text) : repairSplitSmallCapsHeading(parsed?.label ?? heading.text),
  };
}

const COMMON_SCIENTIFIC_HEADINGS = new Set([
  "ABSTRACT",
  "ACKNOWLEDGEMENT",
  "ACKNOWLEDGEMENTS",
  "CONCLUSION",
  "CONCLUSIONS",
  "DISCUSSION",
  "INTRODUCTION",
  "LIMITATION",
  "LIMITATIONS",
  "METHODOLOGY",
  "REFERENCE",
  "REFERENCES",
]);

export function repairSplitSmallCapsHeading(text: string) {
  return text.replace(/\b([A-Z])\s+([A-Z]{2,})\b/g, (match, initial: string, remainder: string) => {
    const joined = `${initial}${remainder}`;
    return COMMON_SCIENTIFIC_HEADINGS.has(joined) ? joined : match;
  });
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
  if ((url.startsWith("/") && !url.startsWith("//")) || url.startsWith("https://") || url.startsWith("http://localhost:")) return url;
  return "#";
}
