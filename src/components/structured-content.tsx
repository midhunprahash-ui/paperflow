/* eslint-disable @next/next/no-img-element */
import type { DocumentNode, InlinePart, PaperAsset } from "@/lib/types/document";

type Assets = Record<string, PaperAsset>;
const bounded = (value: number | null | undefined, fallback: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;

export function SourceImage({ asset, assets, alt = "Original source content", inline, widthEm, descentEm }: {
  asset: string; assets: Assets; alt?: string; inline?: boolean; widthEm?: number | null; descentEm?: number;
}) {
  const url = assets[asset]?.url;
  if (!url || !(url.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url) || url.startsWith("/api/"))) {
    return <span className="source-unavailable">Source image unavailable — reopen the paper to refresh it.</span>;
  }
  return <img loading={inline ? "eager" : "lazy"} decoding="async" src={url} alt={alt} className={inline ? "paper-inline-source" : "paper-source-image"}
    style={inline ? { width: `${bounded(widthEm, 1, 100)}em`, verticalAlign: `-${bounded(descentEm, 0, 5)}em` } : widthEm ? { width: `${bounded(widthEm, 24, 100)}em` } : undefined} />;
}

export function InlineContent({ parts, assets }: { parts: InlinePart[]; assets: Assets }) {
  return <>{parts.map((part, index) => {
    if (part.type === "image") return <SourceImage key={index} {...part} assets={assets} inline />;
    let content: React.ReactNode = part.text;
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
  return <figure className="paper-table"><div className="table-scroll"><table><tbody>
    {Array.from({ length: node.rowCount ?? 0 }, (_, row) => <tr key={row}>{Array.from({ length: node.colCount ?? 0 }, (_, col) => {
      const cell = starts.get(`${row}:${col}`);
      if (!cell) return occupied.has(`${row}:${col}`) ? null : <td key={col} data-unassigned-cell="true" />;
      const Tag = cell.header ? "th" : "td";
      return <Tag key={cell.col} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>
        {cell.sourceAsset ? <SourceImage asset={cell.sourceAsset} assets={assets} alt={`Original table cell; unverified text: ${cell.text}`} /> : cell.text}
      </Tag>;
    })}</tr>)}
  </tbody></table></div>{node.caption && <figcaption>{node.caption}</figcaption>}</figure>;
}
