import { describe, expect, it } from "vitest";
import { extractParserText, normalizeCloudflareDocument } from "./cloudflare-document";

const source = { filename: "paper.pdf", title: "Paper", authors: ["Author"], checksum: "checksum" };

describe("Cloudflare parser output", () => {
  it("uses raw annotations even if the downstream model fails and deduplicates them", () => {
    const annotation = { type: "file", file: { hash: "same", content: [{ type: "text", text: "### Page 1\nActual text" }] } };
    expect(extractParserText({ choices: [{ message: { annotations: [annotation] } }], error: { metadata: { file_annotations: [annotation] } } }))
      .toBe("### Page 1\nActual text");
    expect(() => extractParserText({ choices: [{ message: {} }] })).toThrow("no readable text");
  });

  it("preserves page text, provenance, references, and ownership-independent metadata without inventing figures", () => {
    const paper = normalizeCloudflareDocument('<file name="paper.pdf">\n# document.pdf\n## Metadata\n- Producer=Example\n\n## Contents\n### Page 1\nResearch text.\n\nAnother paragraph.\n### Page 2\nConclusion text.REFERENCES[1] First citation.[2] Second citation.\n</file>', source);
    expect(paper.metadata).toEqual({ title: "Paper", authors: ["Author"], pageCount: 2 });
    expect(paper.sections.filter((s) => s.type === "paragraph").map((s) => s.text)).toEqual(["Research text.", "Another paragraph.", "Conclusion text."]);
    expect(paper.references).toEqual(["First citation.", "Second citation."]);
    expect(paper.sections.map((s) => s.page)).toEqual([1, 1, 1, 2, 2]);
    expect(paper.source.checksum).toBe("checksum");
  });

  it("keeps malformed reference lists in the body rather than losing text", () => {
    const paper = normalizeCloudflareDocument("### Page 1\nBody.REFERENCES[1] A[3] C", source);
    expect(paper.references).toEqual([]);
    expect(paper.sections[1]).toMatchObject({ text: "Body.REFERENCES[1] A[3] C" });
  });

  it.each(["No page metadata", "### Page 2\nText", "### Page 1\nText\n### Page 3\nText", "### Page 1\n"])("rejects missing, incomplete, or empty output: %s", (text) => {
    expect(() => normalizeCloudflareDocument(text, source)).toThrow();
  });
});
