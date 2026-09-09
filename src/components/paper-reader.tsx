import "katex/dist/katex.min.css";
import "./paper-reader.css";
/* eslint-disable @next/next/no-img-element */
import { Fragment } from "react";
import { renderMath } from "@/lib/render-math";
import { readerSections } from "@/lib/reader-presentation";
import { ExtractedEquation } from "./extracted-equation";
import { PaperMarkdown } from "./paper-markdown";
import { ReaderOutline } from "./reader-outline";
import { ReaderPreferences } from "./reader-preferences";
import { InlineContent, SourceImage, StructuredTable } from "./structured-content";
import { ArrowLeft, ExternalLink, FileDown } from "lucide-react";
import Link from "next/link";
import { ReaderProgress } from "./reader-progress";
import type { DocumentNode, HeadingNode, PaperDocument, PaperAsset, ParagraphNode } from "@/lib/types/document";

type OutlineHeading = HeadingNode & {
  displayLevel: number;
  sectionNumber?: string;
  label: string;
};

type SplitAbstract = { label: DocumentNode; separator?: ParagraphNode; paragraphs: ParagraphNode[][]; consumedIds: Set<string> };

export function PaperReader({ paper, backHref = "/library", originalUrl }: { paper: PaperDocument; backHref?: string; originalUrl?: string }) {
  paper = { ...paper, sections: readerSections(paper) };
  const splitAbstract = paper.metadata.abstract ? undefined : findSplitAbstract(paper.sections);
  const headings = buildHeadingOutline(paper.sections.filter((node): node is HeadingNode => node.type === "heading" && node.role !== "title" && node.id !== splitAbstract?.label.id));
  const headingById = new Map(headings.map((heading) => [heading.id, heading]));
  const abstract = paper.metadata.abstract || splitAbstract ? undefined : findInlineAbstract(paper.sections);
  const outline = headings.map(({ id, label, sectionNumber, displayLevel }) => ({ id, label, sectionNumber, displayLevel }));
  if (abstract) outline.unshift({ id: abstract.id, label: "Abstract", sectionNumber: undefined, displayLevel: 1 });
  else if (splitAbstract) outline.unshift({ id: splitAbstract.label.id, label: "Abstract", sectionNumber: undefined, displayLevel: 1 });
  return <main className="reader-page"><ReaderProgress />
    <header className="reader-header"><Link href={backHref} prefetch={true} className="reader-back" aria-label="Back to library"><ArrowLeft size={18} /><span>Library</span></Link><div className="reader-document-label"><span>{paper.metadata.title}</span></div><div className="reader-tools"><ReaderPreferences />{originalUrl && <a className="reader-tool" href={originalUrl} target="_blank" rel="noreferrer"><FileDown size={16} /><span>Original PDF</span></a>}</div></header>
    <div className="reader-layout"><ReaderOutline headings={outline} />
      <article className="paper-article"><header className="paper-title-block"><div className="paper-reading-meta"><span className="paper-type">Research paper</span><span>{paper.source.type.toUpperCase()}{paper.metadata.pageCount ? ` · ${paper.metadata.pageCount} pages` : ""}</span></div><h1>{paper.metadata.title}</h1>{paper.metadata.authors.length > 0 && <p className="paper-byline">{paper.metadata.authors.join(" · ")}</p>}{paper.metadata.publishedAt && <p className="paper-date">{paper.metadata.publishedAt}</p>}<div className="paper-title-rule" /></header>
        {paper.metadata.abstract && <section className="abstract-block"><h2>Abstract</h2><div className="paper-prose"><PaperMarkdown text={paper.metadata.abstract} idPrefix="abstract" /></div></section>}
        <div className="paper-content"><DocumentBlocks nodes={paper.sections} assets={paper.assets ?? {}} headings={headingById} abstract={abstract} splitAbstract={splitAbstract} /></div>
        {paper.references.length > 0 && <section className="references" id="references"><h2>References</h2><ol className="paper-reference-list" role="list">{paper.references.map((reference, index) => {
          const match = reference.match(/^\s*(\[(\d+)\]|(\d+)[.)])\s*/);
          return <li key={`${index}-${reference.slice(0, 20)}`} value={match ? Number(match[2] ?? match[3]) : index + 1}><span className="paper-reference-number">{match?.[1] ?? `[${index + 1}]`}</span><div><PaperMarkdown text={match ? reference.slice(match[0].length) : reference} inline /></div></li>;
        })}</ol></section>}
        <footer className="paper-end"><span /><p>End of paper</p><Link href={backHref} prefetch={true}>Return to your library</Link></footer>
      </article>
    </div>
  </main>;
}

// Some PDFs put the label in the paragraph ("Abstract—...") rather than a
// separate heading. Recognize only explicit front-matter labels; never infer
// abstract boundaries from unlabelled prose or modify the stored manifest.
const ABSTRACT_PREFIX = /^\s*(?:Abstract\b|\*\*Abstract\*\*|\*Abstract\*|__Abstract__|_Abstract_)\s*[-–—:]\s*/i;

function findInlineAbstract(nodes: DocumentNode[]): ParagraphNode | undefined {
  for (const node of nodes) {
    if (node.role === "title") continue;
    if (node.type === "heading" || (node.page !== undefined && node.page > 1)) break;
    if (node.type !== "paragraph" || node.sourceAsset || node.sourceFragments?.length) continue;
    const prefix = node.text.match(ABSTRACT_PREFIX)?.[0];
    if (!prefix || !node.text.slice(prefix.length).trim()) continue;
    let inline = node.inline;
    if (inline) {
      // Strip the label across inline text runs, keeping formatting and math
      // images. A mismatch is ambiguous, so keep the original presentation.
      const firstImage = inline.findIndex(part => part.type === "image");
      const leadingText = inline.slice(0, firstImage < 0 ? inline.length : firstImage).map(part => part.type === "text" ? part.text : "").join("");
      const inlinePrefix = leadingText.match(ABSTRACT_PREFIX)?.[0];
      if (!inlinePrefix) continue;
      let remaining = inlinePrefix.length;
      inline = inline.flatMap(part => {
        if (remaining === 0 || part.type !== "text") return [part];
        const text = part.text.slice(remaining);
        remaining = Math.max(0, remaining - part.text.length);
        return text ? [{ ...part, text }] : [];
      });
    }
    return { ...node, text: node.text.slice(prefix.length), inline };
  }
}

// Join only neighbouring source fragments with geometry consistent with one
// paragraph. Missing geometry and larger vertical gaps retain paragraph breaks.
function adjacentAbstractFragments(previous: ParagraphNode, next: ParagraphNode) {
  const a = previous.bounds, b = next.bounds;
  if (!a || !b || a.some(n => !Number.isFinite(n)) || b.some(n => !Number.isFinite(n))) return false;
  const height = Math.min(a[3] - a[1], b[3] - b[1]);
  if (height <= 0 || previous.page !== next.page) return false;
  const sameLine = Math.abs(a[1] - b[1]) < height * .5;
  const overlapsColumn = Math.min(a[2], b[2]) > Math.max(a[0], b[0]);
  return (sameLine || overlapsColumn) && b[1] >= a[1] - height * .5 && b[1] - a[3] <= height * 1.2;
}

function findSplitAbstract(nodes: DocumentNode[]): SplitAbstract | undefined {
  for (let index = 0; index < nodes.length; index++) {
    const label = nodes[index];
    if (label.role === "title") continue;
    if (label.page !== undefined && label.page > 1) break;
    const isLabel = (label.type === "paragraph" || label.type === "heading") && /^(?:Abstract|\*\*Abstract\*\*|\*Abstract\*|__Abstract__|_Abstract_)\s*[-–—:]?$/i.test(label.text.trim());
    if (!isLabel) { if (label.type === "heading") break; continue; }
    if (label.sourceAsset || label.sourceFragments?.length) return;
    const result: SplitAbstract = { label, paragraphs: [], consumedIds: new Set([label.id]) };
    for (let cursor = index + 1; cursor < nodes.length; cursor++) {
      const node = nodes[cursor];
      // Explicit end markers keep keywords, affiliations and body sections out.
      if (node.type === "heading" || (node.type === "paragraph" && /^\s*(?:\*{1,2}|_{1,2})?(?:Key\s*words|Index\s+Terms)\b/i.test(node.text))) {
        return result.paragraphs.length ? result : undefined;
      }
      if (node.type !== "paragraph" || node.page !== label.page || node.sectionId !== label.sectionId || node.sourceAsset || node.sourceFragments?.length) return;
      if (!result.paragraphs.length && !result.separator && /^\s*[-–—:]\s*$/.test(node.text)) {
        result.separator = node;
        result.consumedIds.add(node.id);
        continue;
      }
      const group = result.paragraphs.at(-1);
      const previous = group?.at(-1);
      if (group && previous && adjacentAbstractFragments(previous, node)) group.push(node);
      else result.paragraphs.push([node]);
      result.consumedIds.add(node.id);
    }
    // No reliable end boundary: leave the original blocks untouched.
    return;
  }
}

function SplitAbstractContent({ abstract, assets }: { abstract: SplitAbstract; assets: Record<string, PaperAsset> }) {
  return <>
    {abstract.separator && <span id={abstract.separator.id} data-source-id={abstract.separator.sourceId} aria-hidden="true" />}
    {abstract.paragraphs.map(group => <p key={group[0].id} className="paper-paragraph">{group.map((node, index) => {
      const previous = group[index - 1];
      // Keep an explicit source hyphen, but remove the PDF line-wrap space.
      const separator = previous && /[\p{L}\p{N}]-\s*$/u.test(previous.text) && /^\s*\p{Ll}/u.test(node.text) ? "" : " ";
      return <Fragment key={node.id}>{index > 0 && separator}<span id={node.id} data-source-id={node.sourceId} data-section-id={node.sectionId}>
        {node.inline ? <InlineContent parts={node.inline} assets={assets} /> : <PaperMarkdown text={node.text.trim()} inline />}
      </span></Fragment>;
    })}</p>)}
  </>;
}

function DocumentBlocks({ nodes, assets, headings, abstract, splitAbstract }: { nodes: DocumentNode[]; assets: Record<string, PaperAsset>; headings: Map<string, OutlineHeading>; abstract?: ParagraphNode; splitAbstract?: SplitAbstract }) {
  const rendered = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.role === "title") continue;
    if (splitAbstract?.consumedIds.has(node.id)) {
      if (node.id === splitAbstract.label.id) rendered.push(<section key={node.id} id={node.id} className="abstract-block" aria-label="Abstract" data-source-id={node.sourceId} data-section-id={node.sectionId}>
        <h2>Abstract</h2><SplitAbstractContent abstract={splitAbstract} assets={assets} />
      </section>);
      continue;
    }
    if (node.id === abstract?.id) {
      rendered.push(<section key={node.id} id={node.id} className="abstract-block" aria-label="Abstract" data-source-id={node.sourceId} data-section-id={node.sectionId}>
        <h2>Abstract</h2>
        <DocumentBlock node={abstract} assets={assets} />
      </section>);
      continue;
    }
    if (node.type === "list_item" && node.role === "reference" && !node.sourceAsset && !node.sourceFragments?.length) {
      const entries: { reference: typeof node; continuations: ParagraphNode[] }[] = [{ reference: node, continuations: [] }];
      while (index + 1 < nodes.length) {
        const next = nodes[index + 1];
        if (next.sectionId !== node.sectionId) break;
        if (next.type === "list_item" && next.role === "reference" && next.listId === node.listId && !next.sourceAsset && !next.sourceFragments?.length) {
          entries.push({ reference: next, continuations: [] });
        } else if (next.type === "paragraph" && !/^\s*\[\d+\]/.test(next.text)) {
          // A bibliography entry can continue across a PDF column/page. Keep
          // those blocks under its marker instead of promoting them to body text.
          entries.at(-1)!.continuations.push(next);
        } else break;
        index++;
      }
      rendered.push(<ol key={node.id} className="paper-reference-list" role="list">{entries.map(({ reference, continuations }) => <li key={reference.id} id={reference.id} data-source-id={reference.sourceId} data-section-id={reference.sectionId}>
        <span className="paper-reference-number">{reference.marker}</span>
        <div>{reference.inline ? <InlineContent parts={reference.inline} assets={assets} /> : <PaperMarkdown text={reference.text} inline />}
          {continuations.map((part, partIndex) => {
            const previous = continuations[partIndex - 1] ?? reference;
            const separator = /[\p{L}\p{N}]-\s*$/u.test(previous.text) && /^\s*\p{Ll}/u.test(part.text) ? "" : " ";
            return <Fragment key={part.id}>{separator}<span id={part.id} data-source-id={part.sourceId} data-section-id={part.sectionId}>
              {part.sourceAsset || part.sourceFragments?.length ? <ReferenceSource node={part} assets={assets} /> : part.inline ? <InlineContent parts={part.inline} assets={assets} /> : <PaperMarkdown text={part.text} inline />}
            </span></Fragment>;
          })}
        </div>
      </li>)}</ol>);
      continue;
    }
    if ((node.type === "list" || node.type === "list_item") && !node.sourceAsset && !node.sourceFragments?.length) {
      const group: typeof node[] = [node];
      while (index + 1 < nodes.length) {
        const next = nodes[index + 1];
        if (next.sourceAsset || next.sourceFragments?.length || next.sectionId !== node.sectionId) break;
        if (node.type === "list" && next.type === "list" && next.ordered === node.ordered) group.push(next);
        else if (node.type === "list_item" && next.type === "list_item" && next.listId === node.listId) group.push(next);
        else break;
        index++;
      }
      const isReference = node.role === "reference";
      const Tag = isReference || node.role === "ordered-list" || (node.type === "list" && node.ordered) ? "ol" : "ul";
      rendered.push(<Tag key={node.id} className={isReference ? "paper-reference-list" : node.type === "list_item" ? "paper-source-list" : "paper-list"} role="list">{group.flatMap(item => {
        const texts = item.type === "list" ? item.items : [item.text];
        return texts.map((text, itemIndex) => <li key={`${item.id}-${itemIndex}`} id={itemIndex === 0 ? item.id : undefined} data-source-id={item.sourceId} data-section-id={item.sectionId} data-list-id={item.type === "list_item" ? item.listId : undefined}>
          {item.type === "list_item" && <span className={isReference ? "paper-reference-number" : "paper-list-marker"}>{item.marker}</span>}
          <div>{item.type === "list_item" && item.inline ? <InlineContent parts={item.inline} assets={assets} /> : <PaperMarkdown text={text} inline />}</div>
        </li>);
      })}</Tag>);
      continue;
    }
    rendered.push(<div key={node.id} id={node.type === "heading" ? undefined : node.id} data-source-id={node.sourceId} data-section-id={node.sectionId}><DocumentBlock node={node} assets={assets} heading={node.type === "heading" ? headings.get(node.id) : undefined} /></div>);
  }
  return rendered;
}

function ReferenceSource({ node, assets }: { node: ParagraphNode; assets: Record<string, PaperAsset> }) {
  return <>{node.sourceFragments?.length ? node.sourceFragments.map((fragment, index) => <SourceImage key={index} asset={fragment.asset} widthEm={fragment.widthEm} assets={assets} alt="Original reference fragment" />) : node.sourceAsset ? <SourceImage asset={node.sourceAsset} assets={assets} alt="Original reference fragment" /> : null}</>;
}

function DocumentBlock({ node, heading, assets }: { node: DocumentNode; heading?: OutlineHeading; assets: Record<string, PaperAsset> }) {
  if (node.role === "title") return null;
  if (node.sourceFragments?.length) return <div className="paper-source-paragraph">{node.sourceFragments.map((fragment, i) => <SourceImage key={i} asset={fragment.asset} widthEm={fragment.widthEm} assets={assets} alt={"text" in node ? `Original paragraph; unverified text: ${node.text}` : "Original paragraph"} />)}</div>;
  if (node.type === "formula" && node.sourceAsset && node.candidateLatex) return <figure className="paper-formula"><ExtractedEquation latex={node.candidateLatex}><SourceImage asset={node.sourceAsset} assets={assets} alt="Original equation" /></ExtractedEquation>{node.label && <figcaption>{node.label}</figcaption>}</figure>;
  if (node.sourceAsset && node.type !== "figure") return <figure className="paper-formula"><SourceImage asset={node.sourceAsset} assets={assets} alt="Original equation" />{node.type === "formula" && node.label && <figcaption>{node.label}</figcaption>}</figure>;
  switch (node.type) {
    case "heading": {
      const display = heading ?? toOutlineHeading(node, node.level);
      const Tag = `h${Math.min(6, display.displayLevel + 1)}` as "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag id={node.id} className={`paper-heading paper-heading-level-${display.displayLevel}`} data-numbered={!!display.sectionNumber || undefined}>{display.sectionNumber && <span className="paper-section-number">{display.sectionNumber}</span>}<span><PaperMarkdown text={display.label} inline /></span></Tag>;
    }
    case "paragraph": return node.inline ? <p className="paper-paragraph"><InlineContent parts={node.inline} assets={assets} /></p> : <div className="paper-prose"><PaperMarkdown text={node.text} idPrefix={node.id} /></div>;
    case "list_item": return <div className="paper-source-list-item" data-list-id={node.listId}><span className="paper-list-marker">{node.marker}</span><span><PaperMarkdown text={node.text} inline /></span></div>;
    case "caption": return <p className="paper-source-caption" data-caption-of={node.captionOf}><PaperMarkdown text={node.text} inline /></p>;
    case "list": {
      const Tag = node.ordered ? "ol" : "ul";
      return <Tag className="paper-list">{node.items.map((item, index) => <li key={`${index}-${item.slice(0, 16)}`}><PaperMarkdown text={item} inline /></li>)}</Tag>;
    }
    case "formula": return <Formula node={node} />;
    case "table": if (node.cells) return <StructuredTable node={node} assets={assets} />; return <figure className="paper-table"><div className="table-scroll" role="region" aria-label="Paper table" tabIndex={0}><table><thead><tr>{node.headers.map((header, index) => <th key={`${index}-${header}`} scope="col"><PaperMarkdown text={header} inline /></th>)}</tr></thead><tbody>{node.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><PaperMarkdown text={cell} inline /></td>)}</tr>)}</tbody></table></div>{node.caption && <figcaption><PaperMarkdown text={node.caption} inline /></figcaption>}</figure>;
    case "figure": if (node.sourceAsset) return <figure className="paper-figure"><SourceImage asset={node.sourceAsset} assets={assets} alt={node.alt} />{node.caption && <figcaption><PaperMarkdown text={node.caption} inline /></figcaption>}</figure>; return <figure className="paper-figure"><a href={safeUrl(node.assetUrl)} target="_blank" rel="noreferrer">{/* Signed private assets cannot use the build-time Next image optimizer. */}<img loading="lazy" decoding="async" src={safeUrl(node.assetUrl)} alt={node.alt} /><span><ExternalLink size={14} />Open full size</span></a>{node.caption && <figcaption><PaperMarkdown text={node.caption} inline /></figcaption>}</figure>;
    case "code": return <pre className="paper-code" tabIndex={0} aria-label="Code example"><code>{node.code}</code></pre>;
    case "footnote": return <aside className="paper-footnote"><sup>{node.label}</sup><PaperMarkdown text={node.text} inline /></aside>;
  }
}

export function buildHeadingOutline(headings: HeadingNode[]): OutlineHeading[] {
  const numberedTopLevelCount = headings.filter((heading) => parseHeadingNumber(heading.text)?.level === 1).length;
  const useNumberedFallback = numberedTopLevelCount >= 3 && headings.every((heading) => heading.level === 1) && !headings.some(heading => /^[IVXLCDM]{2,}[.)]\s/.test(heading.text.trim()));
  let insideNumberedSection = false;
  const romanSections = headings.some(heading => /^[IVXLCDM]{2,}[.)]\s/.test(heading.text.trim()));
  let insideLetteredSection = false;

  return headings.map((heading) => {
    const parsed = parseHeadingNumber(heading.text);
    if (parsed) insideNumberedSection = true;
    if (parsed?.kind === "roman") insideLetteredSection = false;
    if (parsed?.kind === "letter") insideLetteredSection = true;
    const inferred = romanSections && insideLetteredSection && /^\d+[)]\s/.test(heading.text.trim()) ? 3 : parsed?.level;
    const level = heading.explicitHierarchy ? heading.level : inferred ?? (useNumberedFallback && insideNumberedSection ? 2 : heading.level);
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
  "RELATED",
  "BACKGROUND",
  "EVALUATION",
  "EXPERIMENTAL",
  "RESULTS",
]);

export function repairSplitSmallCapsHeading(text: string) {
  return text.replace(/\b([A-Z])\s+([A-Z]{2,})\b/g, (match, initial: string, remainder: string) => {
    const joined = `${initial}${remainder}`;
    return COMMON_SCIENTIFIC_HEADINGS.has(joined) ? joined : match;
  });
}

function parseHeadingNumber(text: string) {
  const match = text.trim().match(/^(\d+(?:\.\d+)*)(?:[.)])?\s+(.+)$/);
  if (match) return { number: match[1], label: match[2], level: match[1].split(".").length, kind: "decimal" };
  const roman = text.trim().match(/^([IVXLCDM]+)[.)]\s+(.+)$/);
  if (roman && (roman[1].length > 1 || /^[IVX]$/.test(roman[1])) && /^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(roman[1])) return { number: roman[1], label: roman[2], level: 1, kind: "roman" };
  const letter = text.trim().match(/^([A-Z])[.)]\s+(.+)$/);
  if (letter) return { number: letter[1], label: letter[2], level: 2, kind: "letter" };
  const appendix = text.trim().match(/^(Appendix\s+[A-Z])[.:]?\s+(.+)$/i);
  return appendix ? { number: appendix[1], label: appendix[2], level: 1, kind: "appendix" } : null;
}

function Formula({ node }: { node: Extract<DocumentNode, { type: "formula" }> }) {
  const html = renderMath(node.latex, true);
  if (html === null) return <figure className="paper-formula formula-fallback"><code>{node.latex}</code>{node.label && <figcaption>{node.label}</figcaption>}</figure>;
  return <figure className="paper-formula"><div tabIndex={0} role="region" aria-label={node.label ?? "Equation"} dangerouslySetInnerHTML={{ __html: html }} />{node.label && <figcaption>{node.label}</figcaption>}</figure>;
}

export function safeUrl(url: string) {
  if ((url.startsWith("/") && !url.startsWith("//")) || url.startsWith("https://") || url.startsWith("http://localhost:")) return url;
  return "#";
}
