import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buildHeadingOutline, PaperReader, repairSplitSmallCapsHeading, safeUrl } from "./paper-reader";
import { demoPaper } from "@/lib/demo";
import type { PaperDocument, ParagraphNode } from "@/lib/types/document";

afterEach(cleanup);

const inlineAbstractPaper: PaperDocument = {
  ...demoPaper,
  metadata: { title: "Inline abstract regression", authors: [] },
  references: [],
  sections: [
    { id: "title", type: "heading", role: "title", level: 1, text: "Inline abstract regression", order: 0 },
    { id: "authors", type: "paragraph", text: "Author affiliations", order: 1 },
    { id: "abstract-source", sourceId: "source-19", type: "paragraph", page: 1, order: 2, text: "Abstract- Mental health crisis intervention immediately follows the use of digital text analysis. Practical guidance helps select system designs for mental health monitoring operations." },
    { id: "keywords", type: "paragraph", text: "Keywords- BERT, DistilBERT, BiLSTM, LIWC.", order: 3 },
    { id: "intro", type: "heading", level: 1, explicitHierarchy: true, text: "I. INTRODUCTION", order: 4 },
    { id: "body", type: "paragraph", text: "The introduction continues in the second column.", order: 5 },
  ],
};

const splitAbstractLines = ["Abstract", "—", "Mental health crisis intervention immediately follows", "the use of digital text analysis. Safety-", "critical scenarios require careful analysis. The study conducts", "a", "complete assessment of seven fine-tuning", "strategies. Practical guidance helps select system designs for mental health monitoring operations."];
const splitAbstractPaper: PaperDocument = { ...inlineAbstractPaper, sections: [
  ...splitAbstractLines.map((text, order): ParagraphNode => ({ id: `fragment-${order}`, sourceId: `source-${order}`, type: "paragraph", text, order, page: 1, sectionId: null, bounds: [45, 277 + order * 11, 289, 284.5 + order * 11] })),
  { id: "keywords", type: "paragraph", text: "Keywords— BERT, DistilBERT.", order: 8, page: 1, sectionId: null },
  { id: "intro", type: "heading", level: 1, text: "I. INTRODUCTION", order: 9 },
] };

describe("PaperReader", () => {
  it("keeps reference continuations inside the numbered entry across columns and pages", () => {
    const paper: PaperDocument = { ...demoPaper, references: [], parser: { name: "azure-document-intelligence", version: "test", reviewRequired: true, limits: "" }, sections: [
      { id: "refs", type: "heading", text: "REFERENCES", level: 1, order: 0 },
      { id: "ref7", sourceId: "source7", sectionId: "refs", type: "paragraph", text: "[7] Author. A CNN-BiLSTM", order: 1, page: 6 },
      { id: "continued7", sourceId: "source7b", sectionId: "refs", type: "paragraph", text: "Hybrid Model. https://doi.org/10.48550/arXiv.2501.11094", order: 2, page: 6 },
      { id: "journal7", sourceId: "source7c", sectionId: "refs", type: "paragraph", text: "arXiv", inline: [{ type: "text", text: "arXiv", italic: true }], order: 3, page: 6 },
      { id: "ref8", sectionId: "refs", type: "paragraph", text: "[8] Second author. Dataset.", order: 4, page: 6 },
      { id: "continued8", sectionId: "refs", type: "paragraph", text: "https://example.com/dataset", order: 5, page: 7 },
      { id: "appendix", type: "heading", text: "Appendix A. Materials", level: 1, order: 6 },
      { id: "body", type: "paragraph", text: "Separate body text.", order: 7 },
    ] };
    const before = JSON.stringify(paper);
    const { container } = render(<PaperReader paper={paper} />);
    expect(container.querySelectorAll(".paper-reference-list")).toHaveLength(1);
    expect(container.querySelectorAll(".paper-reference-list li")).toHaveLength(2);
    expect(container.querySelector("#ref7 > div")).toHaveTextContent("Author. A CNN-BiLSTM Hybrid Model. https://doi.org/10.48550/arXiv.2501.11094 arXiv");
    expect(container.querySelector("#ref7 em")).toHaveTextContent("arXiv");
    expect(container.querySelector("#ref7 #continued7 a")).toHaveAttribute("href", "https://doi.org/10.48550/arXiv.2501.11094");
    expect(container.querySelector("#ref8 #continued8 a")).toHaveAttribute("href", "https://example.com/dataset");
    expect(container.querySelector(".paper-reference-list #body")).toBeNull();
    for (const id of ["ref7", "continued7", "journal7", "ref8", "continued8"]) expect(container.querySelectorAll(`#${id}`)).toHaveLength(1);
    expect(container.querySelector("#continued7")).toHaveAttribute("data-source-id", "source7b");
    expect(JSON.stringify(paper)).toBe(before);
  });

  it("does not pull paragraphs from another section into a reference", () => {
    const paper: PaperDocument = { ...demoPaper, references: [], sections: [
      { id: "ref", type: "list_item", text: "Reference.", marker: "[1]", listId: "refs", role: "reference", sectionId: "refs", order: 0 },
      { id: "other", type: "paragraph", text: "Different section.", sectionId: "other-section", order: 1 },
    ] };
    const { container } = render(<PaperReader paper={paper} />);
    expect(container.querySelector("#ref")).not.toHaveTextContent("Different section");
    expect(container.querySelector("#other")).toHaveTextContent("Different section");
  });

  it("presents Azure heading depth, bullets and references while preserving source emphasis and math", () => {
    const paper: PaperDocument = { ...demoPaper, references: [], assets: { "/equation.png": { path: "/equation.png", url: "/api/equation.png", sha256: "test", mediaType: "image/png" } }, parser: { name: "azure-document-intelligence", version: "2024-11-30", reviewRequired: true, limits: "" }, sections: [
      { id: "methods", type: "heading", text: "III. METHODS", level: 1, explicitHierarchy: true, order: 0 },
      { id: "subsection", type: "heading", text: "C. Visual Analysis", level: 1, explicitHierarchy: true, order: 1 },
      { id: "nested", type: "heading", text: "1) Markers", level: 1, explicitHierarchy: true, order: 2 },
      { id: "bullet", sourceId: "source-bullet", type: "paragraph", text: "· Source emphasis", order: 3, inline: [{ type: "text", text: "· " }, { type: "text", text: "Source emphasis", bold: true }] },
      { id: "ordinary", type: "paragraph", text: ". This ambiguous OCR marker stays prose.", order: 4 },
      { id: "refs", type: "heading", text: "REFERENCES", level: 1, order: 5 },
      { id: "citation", type: "paragraph", text: "[7] Author equation", order: 6, inline: [{ type: "text", text: "[7] Author ", italic: true }, { type: "image", asset: "/equation.png", alt: "Original equation" }] },
    ] };
    const before = JSON.stringify(paper);
    const { container } = render(<PaperReader paper={paper} />);
    expect(container.querySelector("#subsection")?.tagName).toBe("H3");
    expect(container.querySelector("#nested")?.tagName).toBe("H4");
    expect(container.querySelector("li#bullet strong")).toHaveTextContent("Source emphasis");
    expect(container.querySelector("#bullet")).toHaveAttribute("data-source-id", "source-bullet");
    expect(container.querySelector("#ordinary p")).toHaveTextContent(". This ambiguous OCR marker stays prose.");
    expect(container.querySelector(".paper-reference-list #citation em")).toHaveTextContent("Author");
    expect(container.querySelector("#citation .paper-reference-number")).toHaveTextContent("[7]");
    expect(container.querySelector("#citation img")).toHaveAttribute("alt", "Original equation");
    expect(JSON.stringify(paper)).toBe(before);
  });

  it("reflows Docling abstract line fragments, including a standalone label, dash and single-word fragment", () => {
    const before = JSON.stringify(splitAbstractPaper);
    const { container } = render(<PaperReader paper={splitAbstractPaper} />);
    const abstract = screen.getByRole("region", { name: "Abstract" });
    expect(abstract.querySelectorAll("p")).toHaveLength(1);
    expect(abstract.querySelector("p")).toHaveTextContent("Mental health crisis intervention immediately follows the use of digital text analysis. Safety-critical scenarios require careful analysis. The study conducts a complete assessment of seven fine-tuning strategies. Practical guidance helps select system designs for mental health monitoring operations.");
    expect(abstract.querySelector("p")).not.toHaveTextContent("—");
    expect(abstract).not.toHaveTextContent("Keywords");
    for (let i = 0; i < splitAbstractLines.length; i++) {
      expect(container.querySelectorAll(`#fragment-${i}`)).toHaveLength(1);
      expect(container.querySelector(`#fragment-${i}`)).toHaveAttribute("data-source-id", `source-${i}`);
    }
    expect(container.querySelector('.reader-toc a[href="#fragment-0"]')).toHaveTextContent("Abstract");
    expect(container.querySelector("#keywords")).toHaveTextContent("Keywords— BERT");
    expect(JSON.stringify(splitAbstractPaper)).toBe(before);
  });

  it("keeps real paragraph breaks and source formatting inside a standalone abstract section", () => {
    const paper: PaperDocument = { ...splitAbstractPaper, sections: [
      { id: "label", type: "heading", text: "Abstract", level: 1, order: 0, page: 1 },
      { id: "first", type: "paragraph", text: "A complete first paragraph.", order: 1, page: 1, bounds: [45, 280, 290, 300] },
      { id: "second", type: "paragraph", text: "An emphasized second paragraph.", order: 2, page: 1, bounds: [45, 340, 290, 350], inline: [{ type: "text", text: "An emphasized", italic: true }, { type: "text", text: " second paragraph.", bold: true }] },
      { id: "intro", type: "heading", text: "Introduction", level: 1, order: 3, page: 1 },
    ] };
    const { container } = render(<PaperReader paper={paper} />);
    expect(container.querySelectorAll(".abstract-block p")).toHaveLength(2);
    expect(container.querySelector(".abstract-block em")).toHaveTextContent("An emphasized");
    expect(container.querySelector(".abstract-block strong")).toHaveTextContent("second paragraph.");
    expect(container.querySelectorAll('.reader-toc a[href="#label"]')).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: "Abstract" })).toHaveLength(1);
  });

  it("leaves an unbounded fragment sequence untouched", () => {
    const paper: PaperDocument = { ...splitAbstractPaper, sections: splitAbstractPaper.sections.slice(0, -2) };
    const { container } = render(<PaperReader paper={paper} />);
    expect(container.querySelector(".abstract-block")).toBeNull();
    expect(container.querySelector("#fragment-5 p")).toHaveTextContent(/^a$/);
  });

  it("does not merge abstract fragments when source geometry is missing", () => {
    const paper: PaperDocument = { ...splitAbstractPaper, sections: splitAbstractPaper.sections.map(node => ({ ...node, bounds: undefined })) };
    const { container } = render(<PaperReader paper={paper} />);
    expect(container.querySelectorAll(".abstract-block p")).toHaveLength(splitAbstractLines.length - 2);
  });

  it("recognizes the Azure inline abstract without duplicating text, consuming keywords, or changing source IDs", () => {
    const before = JSON.stringify(inlineAbstractPaper);
    const { container } = render(<PaperReader paper={inlineAbstractPaper} />);
    const abstract = screen.getByRole("region", { name: "Abstract" });
    expect(abstract).toHaveAttribute("id", "abstract-source");
    expect(abstract).toHaveAttribute("data-source-id", "source-19");
    expect(abstract.querySelector("p")?.textContent).toBe(inlineAbstractPaper.sections[2].type === "paragraph" ? inlineAbstractPaper.sections[2].text.slice("Abstract- ".length) : "");
    expect(abstract).not.toHaveTextContent("Keywords");
    expect(abstract).not.toHaveTextContent("second column");
    expect(container.querySelectorAll(".abstract-block")).toHaveLength(1);
    expect(container.querySelectorAll("#abstract-source")).toHaveLength(1);
    expect(container.querySelector('.reader-toc a[href="#abstract-source"]')).toHaveTextContent("Abstract");
    expect(container.querySelector('#intro .paper-section-number')).toHaveTextContent("I");
    expect(container.querySelector("#keywords")).toHaveTextContent("Keywords- BERT");
    expect(JSON.stringify(inlineAbstractPaper)).toBe(before);
  });

  it.each(["Abstract—", "Abstract–", "ABSTRACT:", "**Abstract**—", "*Abstract*—", "__Abstract__:"])("recognizes an explicit %s label", label => {
    const paper: PaperDocument = { ...inlineAbstractPaper, sections: [{ id: "abstract-source", type: "paragraph", text: `${label} A complete abstract.`, order: 0 }] };
    const { container } = render(<PaperReader paper={paper} />);
    expect(container.querySelector(".abstract-block p")).toHaveTextContent(/^A complete abstract\.$/);
  });

  it("preserves formatted inline runs and source equations when removing the abstract label", () => {
    const paper: PaperDocument = { ...inlineAbstractPaper, assets: { equation: { path: "equation.png", sha256: "", mediaType: "image/png", url: "/api/equation" } }, sections: [
      { id: "abstract-source", type: "paragraph", order: 0, text: "Abstract— Important result with an equation.", inline: [
        { type: "text", text: "Ab", italic: true }, { type: "text", text: "stract", bold: true },
        { type: "text", text: "— Important", bold: true }, { type: "text", text: " result ", italic: true },
        { type: "image", asset: "equation", alt: "Source equation", widthEm: 2 }, { type: "text", text: " remains intact." },
      ] },
    ] };
    const { container } = render(<PaperReader paper={paper} />);
    expect(container.querySelector(".abstract-block strong")).toHaveTextContent(/^Important$/);
    expect(container.querySelector(".abstract-block em")).toHaveTextContent("result");
    expect(container.querySelector(".abstract-block img")).toHaveAttribute("src", "/api/equation");
    expect(container.querySelector(".abstract-block p")).toHaveTextContent("Important result remains intact.");
  });

  it("does not infer abstracts from ordinary prose, later sections, or source-image fallbacks", () => {
    const paper: PaperDocument = { ...inlineAbstractPaper, sections: [
      { id: "ordinary", type: "paragraph", text: "Abstract reasoning is useful.", order: 0 },
      { id: "source", type: "paragraph", text: "Abstract— Unverified extraction.", sourceAsset: "missing", order: 1 },
      { id: "intro", type: "heading", level: 1, text: "1. Introduction", order: 2 },
      { id: "later", type: "paragraph", text: "Abstract— A quoted example inside the paper.", order: 3 },
    ] };
    const { container } = render(<PaperReader paper={paper} />);
    expect(container.querySelector(".abstract-block")).toBeNull();
    expect(container.querySelector("#ordinary")).toHaveTextContent("Abstract reasoning is useful.");
    expect(container.querySelector("#source .source-unavailable")).not.toBeNull();
    expect(container.querySelector("#later")).toHaveTextContent("Abstract— A quoted example");
  });

  it("renders complete semantic paper content and math", () => {
    const { container } = render(<PaperReader paper={demoPaper} />);
    expect(screen.getByRole("heading", { level: 1, name: demoPaper.metadata.title })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelector(".katex-mathml")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "References" })).toBeInTheDocument();
  });

  it("rejects executable and unknown asset URLs", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("data:text/html,bad")).toBe("#");
    expect(safeUrl("https://example.com/figure.webp")).toBe("https://example.com/figure.webp");
    expect(safeUrl("/assets/figure.webp")).toBe("/assets/figure.webp");
  });

  it("keeps section numbering aligned and infers nested headings for flat legacy manifests", () => {
    const outline = buildHeadingOutline([
      { id: "one", type: "heading", level: 1, text: "1. Introduction", order: 1 },
      { id: "two", type: "heading", level: 1, text: "2. Method", order: 2 },
      { id: "three", type: "heading", level: 1, text: "3. Sources", order: 3 },
      { id: "source", type: "heading", level: 1, text: "Primary dataset", order: 4 },
    ]);

    expect(outline.map(({ sectionNumber, label, displayLevel }) => ({ sectionNumber, label, displayLevel }))).toEqual([
      { sectionNumber: "1", label: "Introduction", displayLevel: 1 },
      { sectionNumber: "2", label: "Method", displayLevel: 1 },
      { sectionNumber: "3", label: "Sources", displayLevel: 1 },
      { sectionNumber: undefined, label: "Primary dataset", displayLevel: 2 },
    ]);
  });

  it("repairs split small-caps words without joining legitimate heading words", () => {
    expect(repairSplitSmallCapsHeading("VIII. A CKNOWLEDGEMENT")).toBe("VIII. ACKNOWLEDGEMENT");
    expect(repairSplitSmallCapsHeading("VI. L IMITATIONS & DEPLOYMENT SAFEGUARDS")).toBe(
      "VI. LIMITATIONS & DEPLOYMENT SAFEGUARDS",
    );
    expect(repairSplitSmallCapsHeading("A NEW METHOD")).toBe("A NEW METHOD");
  });
});
