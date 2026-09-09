/* eslint-disable @next/next/no-img-element */
import { PaperMarkdown } from "./paper-markdown";
import { ExtractedEquation, equationSourceUrl } from "./extracted-equation";
import type { DocumentNode, InlinePart, PaperAsset } from "@/lib/types/document";

type Assets = Record<string, PaperAsset>;
const bounded = (value: number | null | undefined, fallback: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;

export function SourceImage({ asset, assets, alt = "Original source content", inline, widthEm, descentEm }: {
  asset: string; assets: Assets; alt?: string; inline?: boolean; widthEm?: number | null; descentEm?: number;
}) {
  const url = equationSourceUrl(assets[asset]?.url);
  if (!url) {
    return <span className="source-unavailable">Source image unavailable — reopen the paper to refresh it.</span>;
  }
  return <img loading={inline ? "eager" : "lazy"} decoding="async" src={url} alt={alt} className={inline ? "paper-inline-source" : "paper-source-image"}
    style={inline ? { width: `${bounded(widthEm, 1, 100)}em`, verticalAlign: `-${bounded(descentEm, 0, 5)}em` } : widthEm ? { width: `${bounded(widthEm, 24, 100)}em` } : undefined} />;
}

export function InlineContent({ parts, assets }: { parts: InlinePart[]; assets: Assets }) {
  return <>{parts.map((part, index) => {
    if (part.type === "image") return <ExtractedEquation key={index} latex={part.candidateLatex} inline sourceUrl={assets[part.asset]?.url}><SourceImage {...part} assets={assets} inline /></ExtractedEquation>;
    let content: React.ReactNode = <PaperMarkdown text={part.text} inline />;
    if (part.bold) content = <strong>{content}</strong>;
    if (part.italic) content = <em>{content}</em>;
    if (part.script === "sub") content = <sub>{content}</sub>;
    if (part.script === "sup") content = <sup>{content}</sup>;
    return <span key={index}>{content}</span>;
  })}</>;
}

export function StructuredTable({ node, assets }: { node: Extract<DocumentNode, { type: "table" }>; assets: Assets }) {
  const starts = new Map(node.cells?.map(cell => [`${cell.row}:${cell.col}`, cell]));
  const occupied = new Set<string>();
  for (const cell of node.cells ?? []) {
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c++) occupied.add(`${r}:${c}`);
    }
  }
  return <figure className="paper-table"><div className="table-scroll" role="region" aria-label="Paper table" tabIndex={0}><table><tbody>
    {Array.from({ length: node.rowCount ?? 0 }, (_, row) => <tr key={row}>{Array.from({ length: node.colCount ?? 0 }, (_, col) => {
      const cell = starts.get(`${row}:${col}`);
      if (!cell) return occupied.has(`${row}:${col}`) ? null : <td key={col} data-unassigned-cell="true" />;
      const Tag = cell.header ? "th" : "td";
      return <Tag key={cell.col} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>
        {cell.inline ? <InlineContent parts={cell.inline} assets={assets} /> : cell.sourceAsset ? <SourceImage asset={cell.sourceAsset} assets={assets} alt={`Original table cell; unverified text: ${cell.text}`} /> : <PaperMarkdown text={cell.text} inline />}
      </Tag>;
    })}</tr>)}
  </tbody></table></div>{node.caption && <figcaption><PaperMarkdown text={node.caption} inline /></figcaption>}</figure>;
}
