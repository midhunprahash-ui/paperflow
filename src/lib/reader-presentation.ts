import type { DocumentNode, InlinePart, PaperDocument } from "./types/document";
import { formulaHeading } from "./formula-heading";

// Presentation copies keep persisted OCR text, source IDs and equation assets intact.
export function readerSections(paper: PaperDocument): DocumentNode[] {
  if (paper.parser?.name !== "azure-document-intelligence") return paper.sections;
  const numbered = new Map<string, { marker: RegExpMatchArray; listId: string }>();
  for (let i = 0; i < paper.sections.length; i++) {
    const group: { node: DocumentNode; marker: RegExpMatchArray }[] = [];
    for (let j = i; j < paper.sections.length; j++) {
      const node = paper.sections[j];
      if (node.type !== "paragraph" || node.sourceAsset || node.sourceFragments?.length || node.sectionId !== paper.sections[i].sectionId) break;
      const marker = node.text.match(/^\s*((\d+|[a-z])[.)])\s+/);
      if (!marker) break;
      const previous = group.at(-1)?.marker[2];
      const value = (token: string) => /^\d+$/.test(token) ? Number(token) : token.charCodeAt(0);
      if (previous && (/^\d+$/.test(previous) !== /^\d+$/.test(marker[2]) || value(marker[2]) !== value(previous) + 1)) break;
      group.push({ node, marker });
    }
    if (group.length < 2) continue;
    for (const { node, marker } of group) numbered.set(node.id, { marker, listId: `azure-numbered-${paper.sections[i].id}` });
    i += group.length - 1;
  }
  let references = false;
  let previousHeading: string | undefined;
  return paper.sections.map(node => {
    if (node.type === "formula" && node.candidateLatex && !node.label && node.verified !== true) {
      const heading = formulaHeading(node.candidateLatex, previousHeading);
      if (heading) {
        previousHeading = heading;
        references = /^(?:\S+\.\s+)?(?:References|Bibliography)$/.test(heading);
        // Only the presentation copy changes; the stored candidate, source crop
        // and raw provider evidence remain available in the original manifest.
        return { ...node, type: "heading", text: heading, level: 1, explicitHierarchy: false, sourceAsset: undefined, sourceFragments: undefined };
      }
    }
    if (node.type === "heading") {
      if (node.role !== "title") previousHeading = node.text;
      references = /^(?:(?:[IVX]+|\d+)[.)]?\s+)?references\s*$/i.test(node.text.trim());
      // Azure's sectionHeading role provides no authoritative heading depth.
      return { ...node, explicitHierarchy: false };
    }
    if (node.type !== "paragraph" || node.sourceAsset || node.sourceFragments?.length) return node;
    const sequence = numbered.get(node.id);
    const marker = references ? node.text.match(/^\s*(\[\d+\])\s+/) : sequence?.marker ?? node.text.match(/^\s*([•·▪●])\s+/);
    if (!marker) return node;
    let inline = node.inline;
    if (inline) {
      const firstImage = inline.findIndex(part => part.type === "image");
      const prefix = inline.slice(0, firstImage < 0 ? inline.length : firstImage).map(part => part.type === "text" ? part.text : "").join("");
      if (!prefix.startsWith(marker[0])) return node;
      let remaining = marker[0].length;
      inline = inline.flatMap((part): InlinePart[] => {
        if (part.type !== "text" || !remaining) return [part];
        const text = part.text.slice(remaining);
        remaining = Math.max(0, remaining - part.text.length);
        return text ? [{ ...part, text }] : [];
      });
    }
    return { ...node, type: "list_item", text: node.text.slice(marker[0].length), inline,
      marker: references || sequence ? marker[1] : "•", role: references ? "reference" : sequence ? "ordered-list" : node.role,
      listId: references ? `azure-references-${node.sectionId ?? "front"}` : sequence?.listId ?? `azure-bullets-${node.sectionId ?? "front"}` };
  });
}
