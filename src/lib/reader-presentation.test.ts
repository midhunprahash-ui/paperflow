import { describe, expect, it } from "vitest";
import { readerSections } from "./reader-presentation";
import type { PaperDocument } from "./types/document";

const paper: PaperDocument = {
  schemaVersion: 2, metadata: { title: "Lists", authors: [] }, references: [],
  source: { type: "pdf", filename: "lists.pdf" },
  parser: { name: "azure-document-intelligence", version: "test", reviewRequired: true, limits: "" },
  sections: ["1) First", "2) Second", "A separate paragraph", "4) Standalone label", "a) First letter", "b) Second letter", "Another paragraph", "3. Third", "4. Fourth"].map((text, order) => ({ id: `p${order}`, type: "paragraph", text, order })),
};

describe("Azure reader presentation", () => {
  it("groups consecutive source numbers and letters without inventing list membership", () => {
    const sections = readerSections(paper);
    expect(sections.map(n => n.type)).toEqual(["list_item", "list_item", "paragraph", "paragraph", "list_item", "list_item", "paragraph", "list_item", "list_item"]);
    expect(sections[0]).toMatchObject({ text: "First", marker: "1)", role: "ordered-list", listId: "azure-numbered-p0" });
    expect(sections[1]).toMatchObject({ listId: "azure-numbered-p0" });
    expect(sections[4]).toMatchObject({ marker: "a)", listId: "azure-numbered-p4" });
    expect(sections[7]).toMatchObject({ marker: "3.", listId: "azure-numbered-p7" });
    expect(paper.sections[0]).toMatchObject({ type: "paragraph", text: "1) First" });
  });

  it("leaves Docling structure untouched", () => {
    expect(readerSections({ ...paper, parser: { ...paper.parser!, name: "docling" } })).toBe(paper.sections);
  });

  it("keeps source crops and mismatched inline prefixes intact", () => {
    const protectedPaper: PaperDocument = { ...paper, sections: [
      { id: "crop", type: "paragraph", text: "· Source", order: 0, sourceAsset: "crop.png" },
      { id: "mismatch", type: "paragraph", text: "· Source", order: 1, inline: [{ type: "text", text: "Different source" }] },
    ] };
    expect(readerSections(protectedPaper)).toEqual(protectedPaper.sections);
  });
});
