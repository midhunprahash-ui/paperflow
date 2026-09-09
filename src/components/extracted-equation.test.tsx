import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PaperReader } from "./paper-reader";
import { InlineContent, StructuredTable } from "./structured-content";
import { demoPaper } from "@/lib/demo";
import type { PaperDocument } from "@/lib/types/document";

afterEach(cleanup);
const assets = { equation: { path: "equation.png", url: "/api/equation.png", sha256: "test", mediaType: "image/png" } };
const paper: PaperDocument = { ...demoPaper, assets, references: [], sections: [
  { id: "math", type: "formula", order: 0, latex: "", candidateLatex: "\\frac{a+b}{c}", verified: false, sourceAsset: "equation", label: "(1)" },
] };

describe("Azure equation rendering", () => {
  it("typesets a display candidate with MathML and a source disclosure without declaring it verified", () => {
    const before = JSON.stringify(paper);
    const { container } = render(<PaperReader paper={paper} />);
    expect(container.querySelector("#math .katex-display")).not.toBeNull();
    expect(container.querySelector("#math math annotation")).toHaveTextContent("\\frac{a+b}{c}");
    expect(container.querySelector("#math details")).not.toHaveAttribute("open");
    expect(container.querySelector("#math details summary")).toHaveTextContent("Original equation");
    expect(container.querySelector("#math details img")).toHaveAttribute("src", "/api/equation.png");
    expect(container.querySelector("#math figcaption")).toHaveTextContent("(1)");
    expect(JSON.stringify(paper)).toBe(before);
  });

  it.each(["", "\\unsupportedCommand{x}", "\\frac{a}{", "\\def\\x{\\x}\\x"])("retains the crop for empty, unsupported or invalid LaTeX: %s", candidateLatex => {
    const { container } = render(<InlineContent assets={assets} parts={[{ type: "image", asset: "equation", alt: "Original equation", candidateLatex }]} />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("src", "/api/equation.png");
  });

  it("renders inline math in prose with a source link instead of loading its image", () => {
    const { container } = render(<p><InlineContent assets={assets} parts={[
      { type: "text", text: "The value " },
      { type: "image", asset: "equation", alt: "Original equation", candidateLatex: "x^2" },
      { type: "text", text: " is positive." },
    ]} /></p>);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-display")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toHaveAttribute("href", "/api/equation.png");
    expect(container.querySelector("a")).toHaveAccessibleName("View original equation");
    expect(container.querySelector("p")).toHaveTextContent(/^The value .* is positive\.$/);
  });

  it("typesets mixed table text and math while retaining cell spans", () => {
    const { container } = render(<StructuredTable assets={assets} node={{ id: "table", type: "table", order: 0, headers: [], rows: [], rowCount: 1, colCount: 2, cells: [
      { row: 0, col: 0, rowSpan: 1, colSpan: 2, header: false, text: "Value x", sourceAsset: "equation", inline: [{ type: "text", text: "Value " }, { type: "image", asset: "equation", alt: "Original equation", candidateLatex: "x" }] },
    ] }} />);
    expect(container.querySelector("td")).toHaveAttribute("colspan", "2");
    expect(container.querySelector("td .katex")).not.toBeNull();
    expect(container.querySelector("td")).toHaveTextContent(/^Value/);
  });

  it("does not allow an unsafe original-equation link", () => {
    const { container } = render(<InlineContent assets={{ equation: { ...assets.equation, url: "javascript:alert(1)" } }} parts={[{ type: "image", asset: "equation", alt: "Original equation", candidateLatex: "x" }]} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector(".katex")).not.toBeNull();
  });
});
