/* eslint-disable @next/next/no-img-element */
import { isValidElement, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { renderMath } from "@/lib/render-math";

const plugins = [remarkGfm, remarkMath];
const inlineElements = ["a", "strong", "em", "del", "code", "br"];
// Ordinary extracted prose skips the Markdown parser. Rich content stays server-rendered.
const richText = /[*_`~$\\[\]<>\n]|https?:\/\/|www\./;
const blockSyntax = /^\s*(?:#{1,6}\s|(?:\d+[.)]|[-+*])\s|>\s)/;
const components: Components = {
  h1: ({ id, children }) => <h2 id={id}>{children}</h2>,
  img: ({ src, alt }) => <img src={src} alt={alt ?? ""} loading="lazy" decoding="async" />,
  table: ({ children }) => <div className="table-scroll" role="region" aria-label="Paper table" tabIndex={0}><table>{children}</table></div>,
  pre: ({ children }) => {
    const math = isValidElement<{ className?: string }>(children) && children.props.className?.includes("math-display");
    return math ? <div className="paper-math-block" role="region" aria-label="Equation" tabIndex={0}>{children}</div> : <pre className="paper-code" tabIndex={0} aria-label="Code example">{children}</pre>;
  },
  code: ({ className, children }) => {
    if (!/\bmath-(inline|display)\b/.test(className ?? "")) return <code className={className}>{children}</code>;
    const latex = String(children).replace(/\n$/, "");
    const display = className?.includes("math-display") ?? false;
    const html = renderMath(latex, display);
    return html === null ? <code className="math-fallback">{latex}</code> : <span className={display ? "paper-math-display" : "paper-math-inline"} dangerouslySetInnerHTML={{ __html: html }} />;
  },
};

type HtmlNode = { type: string; children?: HtmlNode[]; properties?: Record<string, unknown> };
function scopeFootnoteLabels({ prefix }: { prefix: string }) {
  return (tree: HtmlNode) => {
    function visit(node: HtmlNode) {
      if (node.properties?.id === "footnote-label") node.properties.id = `${prefix}-footnote-label`;
      if (Array.isArray(node.properties?.ariaDescribedBy)) node.properties.ariaDescribedBy = node.properties.ariaDescribedBy.map(id => id === "footnote-label" ? `${prefix}-footnote-label` : id);
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}

export function PaperMarkdown({ text, inline = false, idPrefix = "paper" }: { text: string; inline?: boolean; idPrefix?: string }): ReactNode {
  if (!richText.test(text) && (inline || !blockSyntax.test(text))) return inline ? text : <p>{text}</p>;
  if (inline && !text.trim()) return text;
  const leading = inline ? text.match(/^\s+/)?.[0] ?? "" : "";
  const trailing = inline ? text.match(/\s+$/)?.[0] ?? "" : "";
  return <>{leading}<Markdown remarkPlugins={plugins} remarkRehypeOptions={{ clobberPrefix: `${idPrefix}-` }} rehypePlugins={[[scopeFootnoteLabels, { prefix: idPrefix }]]} components={components} allowedElements={inline ? inlineElements : undefined} unwrapDisallowed={inline}>{inline ? text.trim() : text}</Markdown>{trailing}</>;
}
