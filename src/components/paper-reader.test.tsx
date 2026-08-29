import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildHeadingOutline, PaperReader, safeUrl } from "./paper-reader";
import { demoPaper } from "@/lib/demo";

describe("PaperReader", () => {
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
});
