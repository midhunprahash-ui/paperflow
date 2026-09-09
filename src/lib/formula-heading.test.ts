import { describe, expect, it } from "vitest";
import { formulaHeading } from "./formula-heading";
import { readerSections } from "./reader-presentation";
import type { PaperDocument } from "./types/document";

describe("formula versus heading classification", () => {
  it.each([
    ["\\mathrm { VIII } . \\mathrm { A c k n o m i e d e m e n t }", "VII. CONCLUSION", "VIII. Acknowledgement"],
    ["\\mathrm { V I I I } . \\mathrm { A c k n o m i e d e m e n t }", "VII. CONCLUSION", "VIII. Acknowledgement"],
    ["\\mathrm{V I I I}.\\text{ACKNOWLEDGEMENT}", undefined, "VIII. Acknowledgement"],
    ["\\text{References}", undefined, "References"],
    ["3. \\text{Related Work}", undefined, "3. Related Work"],
    ["A. \\text{Experimental Setup}", undefined, "A. Experimental Setup"],
    ["\\text{Data Availability}", undefined, "Data Availability"],
  ])("recognizes a text-only section label %s", (candidate, previous, expected) => {
    expect(formulaHeading(candidate!, previous)).toBe(expected);
  });

  it.each([
    "\\mathrm{VIII}.\\mathrm{Acknomiedement}",
    "\\text{Results}=x^2", "\\frac{\\text{Methods}}{n}",
    "\\mathrm{References}_{i}", "\\sum_{i=1}^{n}x_i", "H = DistilBERT(T)",
    "\\operatorname{Discussion}", "VIII. Unknownscientificword",
  ])("keeps ambiguous labels and mathematical expressions as math: %s", candidate => {
    expect(formulaHeading(candidate, "II. METHODS")).toBeUndefined();
  });

  it("repairs a saved Azure heading without changing the stored formula, source or real equations", () => {
    const paper: PaperDocument = { schemaVersion: 2, metadata: { title: "Paper", authors: [] }, references: [], source: { type: "pdf", filename: "paper.pdf" }, parser: { name: "azure-document-intelligence", version: "test", reviewRequired: true, limits: "" }, sections: [
      { id: "conclusion", type: "heading", text: "VII. CONCLUSION", level: 1, order: 0 },
      { id: "ack", sourceId: "original-ack", type: "formula", candidateLatex: "\\mathrm{VIII}.\\mathrm{Acknomiedement}", latex: "", verified: false, sourceAsset: "ack.png", order: 1 },
      { id: "math", type: "formula", candidateLatex: "x^2", latex: "", verified: false, sourceAsset: "math.png", order: 2 },
      { id: "labelled", type: "formula", candidateLatex: "\\text{Results}", latex: "", label: "(3)", sourceAsset: "labelled.png", order: 3 },
    ] };
    const before = JSON.stringify(paper);
    const sections = readerSections(paper);
    expect(sections[1]).toMatchObject({ id: "ack", sourceId: "original-ack", type: "heading", text: "VIII. Acknowledgement", sourceAsset: undefined });
    expect(sections[2]).toBe(paper.sections[2]);
    expect(sections[3]).toBe(paper.sections[3]);
    expect(JSON.stringify(paper)).toBe(before);
    expect(readerSections({ ...paper, parser: { ...paper.parser!, name: "docling" } })).toBe(paper.sections);
  });
});
