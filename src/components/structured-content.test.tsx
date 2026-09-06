import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaperReader, buildHeadingOutline } from "./paper-reader";
import { demoPaper } from "@/lib/demo";
import { StructuredTable } from "./structured-content";
import { manifestAssetPaths } from "@/lib/paper-assets";
import type { PaperDocument } from "@/lib/types/document";

const paper: PaperDocument = { ...demoPaper, schemaVersion: 2, references: [],
  assets: { math: { path: "owner/doc/runs/run/math.png", sha256: "a".repeat(64), mediaType: "image/png", url: "/api/math.png" } },
  sections: [
    { id: "s", type: "heading", text: "3.2 Methods", order: 0, level: 1, explicitHierarchy: true },
    { id: "p", sourceId: "#/texts/1", type: "paragraph", text: "x2", order: 1, inline: [{ type: "text", text: "x", bold: true }, { type: "text", text: "2", script: "sub" }, { type: "text", text: "<script>unsafe()</script>" }] },
    { id: "f", type: "formula", order: 2, latex: "UNVERIFIED", sourceAsset: "math" },
    { id: "t", type: "table", order: 3, headers: [], rows: [], rowCount: 2, colCount: 2, cells: [
      { row: 0, col: 0, rowSpan: 1, colSpan: 2, header: true, text: "Merged" },
      { row: 1, col: 0, rowSpan: 1, colSpan: 1, header: false, text: "42" },
      { row: 1, col: 1, rowSpan: 1, colSpan: 1, header: false, text: "43" },
    ] },
    { id: "r", type: "list_item", text: "Reference", marker: "[7]", listId: "references", order: 4 },
  ] };

describe("Docling reader contract", () => {
  it("keeps empty column positions and skips positions covered by row spans", () => {
    const { container } = render(<StructuredTable assets={{}} node={{ id: "gaps", type: "table", order: 0, headers: [], rows: [], rowCount: 2, colCount: 3, cells: [
      { row: 0, col: 0, rowSpan: 2, colSpan: 1, header: false, text: "Spans both rows" },
      { row: 0, col: 2, rowSpan: 1, colSpan: 1, header: false, text: "Third column" },
      { row: 1, col: 2, rowSpan: 1, colSpan: 1, header: false, text: "Still third" },
    ] }} />);
    const rows = container.querySelectorAll("tr");
    expect(rows[0].children).toHaveLength(3);
    expect(rows[1].children).toHaveLength(2);
    expect(rows[0].children[1]).toHaveAttribute("data-unassigned-cell", "true");
    expect(rows[1].children[0]).toHaveAttribute("data-unassigned-cell", "true");
  });
  it("renders typed styles, source equations, explicit markers and merged cells without raw HTML", () => {
    const { container } = render(<PaperReader paper={paper} />);
    expect(container.querySelector("sub")?.textContent).toBe("2");
    expect(container.querySelector("strong")?.textContent).toBe("x");
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByText("UNVERIFIED")).toBeNull();
    expect(screen.getByAltText("Original equation")).toHaveAttribute("src", "/api/math.png");
    expect(screen.getByRole("columnheader", { name: "Merged" })).toHaveAttribute("colspan", "2");
    expect(screen.getByText("[7]")).toBeVisible();
  });
  it("keeps parser-assigned hierarchy even when heading numbering suggests another depth", () => {
    expect(buildHeadingOutline([{ id: "h", order: 0, type: "heading", text: "3.2 Methods", level: 1, explicitHierarchy: true }])[0].displayLevel).toBe(1);
    expect(buildHeadingOutline([{ id: "h", order: 0, type: "heading", text: "C ONCLUSION", level: 1, explicitHierarchy: true }])[0].label).toBe("C ONCLUSION");
  });
  it.each(["other-owner/image.png", "owner/doc/runs/run/../image.png", "owner/doc/runs/run/%2e%2e/image.png"])("rejects asset paths outside this version: %s", path => {
    const bad = { ...paper, assets: { bad: { path, sha256: "a", mediaType: "image/png" } } };
    expect(() => manifestAssetPaths(bad, "owner/doc/runs/run/manifest.json")).toThrow();
  });
});
