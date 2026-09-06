import type { DocumentNode, PaperDocument } from "@/lib/types/document";

type FileAnnotation = { type?: string; file?: { hash?: string; content?: { type?: string; text?: string }[] } };
export type ParserResponse = {
  model?: string;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
  choices?: { message?: { annotations?: FileAnnotation[] } }[];
  error?: { metadata?: { file_annotations?: FileAnnotation[] } };
};

export function extractParserText(response: ParserResponse): string {
  // These annotations are the parser output. Never substitute generated completion text.
  const annotations = [
    ...(response.choices ?? []).flatMap((choice) => choice.message?.annotations ?? []),
    ...(response.error?.metadata?.file_annotations ?? []),
  ];
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const annotation of annotations) {
    if (annotation.type !== "file" || !annotation.file) continue;
    const { hash, content } = annotation.file;
    if (hash && seen.has(hash)) continue;
    if (hash) seen.add(hash);
    for (const part of content ?? []) {
      if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
    }
  }
  const text = parts.join("\n\n").trim();
  if (!text) throw new Error("The parser returned no readable text. Try another PDF or retry later.");
  return text;
}

export function normalizeCloudflareDocument(text: string, source: {
  filename: string; title: string; authors: string[]; checksum: string;
}): PaperDocument {
  // Remove only the known parser envelope and metadata, keeping the raw response separately.
  let body = text.replace(/^<file name="[^\n]*">\s*/, "").replace(/\s*<\/file>\s*$/, "");
  const contents = body.match(/^## Contents\s*$/m);
  if (contents?.index !== undefined && /^# document\.pdf\s*\n## Metadata/m.test(body)) {
    body = body.slice(contents.index + contents[0].length);
  }
  const pages = [...body.matchAll(/^### Page (\d+)\s*$/gm)];
  if (!pages.length || pages.length > 100 || pages.some((page, i) => Number(page[1]) !== i + 1)) {
    throw new Error("The parser did not return a complete sequence of 1–100 pages.");
  }
  const sections: DocumentNode[] = [];
  const references: string[] = [];
  const add = (node: Omit<Extract<DocumentNode, { type: "paragraph" }>, "id" | "order"> |
    Omit<Extract<DocumentNode, { type: "heading" }>, "id" | "order">) => {
    sections.push({ ...node, id: `block-${sections.length + 1}`, order: sections.length });
  };
  for (const [index, match] of pages.entries()) {
    const page = index + 1;
    let content = body.slice(match.index! + match[0].length, pages[index + 1]?.index ?? body.length).trim();
    // Extract an explicitly numbered reference list only on the final page.
    const referenceStart = index === pages.length - 1 ? content.search(/\bREFERENCES\s*(?=\[1\])/u) : -1;
    if (referenceStart >= 0) {
      const referenceText = content.slice(referenceStart).replace(/^REFERENCES\s*/, "");
      const entries = [...referenceText.matchAll(/\[(\d+)\]\s*([\s\S]*?)(?=\[\d+\]|$)/g)];
      if (entries.length && entries.every((entry, i) => Number(entry[1]) === i + 1)) {
        references.push(...entries.map((entry) => entry[2].replace(/\s+/g, " ").trim()));
        content = content.slice(0, referenceStart).trim();
      }
    }
    add({ type: "heading", level: 1, text: `Page ${page}`, page });
    for (const paragraph of content.split(/\n\s*\n/).filter((part) => part.trim())) {
      add({ type: "paragraph", text: paragraph.replace(/\s+/g, " ").trim(), page });
    }
  }
  if (!sections.some((node) => node.type === "paragraph") && !references.length) {
    throw new Error("No readable text was found in this PDF.");
  }
  return {
    schemaVersion: 1,
    metadata: { title: source.title, authors: source.authors, pageCount: pages.length },
    sections,
    references,
    source: { type: "pdf", filename: source.filename, checksum: source.checksum },
  };
}
