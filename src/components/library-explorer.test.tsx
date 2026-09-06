import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryExplorer } from "./library-explorer";
import type { LibraryDocument } from "@/lib/types/document";
vi.mock("./document-actions", () => ({ DocumentActions: () => null }));
vi.mock("./link-pending", () => ({ LinkPending: () => null }));
const documents: LibraryDocument[] = [
  { id: 1, document_ref: "one", title: "Zebra research", authors: ["Ada Lovelace"], source_type: "pdf", status: "ready", active_version_id: 1, page_count: 6, updated_at: "2026-09-06" },
  { id: 2, document_ref: "two", title: "Alpha research", authors: ["Alan Turing"], source_type: "pdf", status: "processing", page_count: 4, updated_at: "2026-09-05" },
];
afterEach(cleanup);
describe("library browsing", () => {
  it("searches titles and authors and clears empty results without navigation", () => {
    render(<LibraryExplorer documents={documents} />);
    const search = screen.getByRole("searchbox", { name: "Search your library" });
    fireEvent.change(search, { target: { value: "lovelace" } });
    expect(screen.getByRole("heading", { name: "Zebra research" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Alpha research" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByRole("heading", { name: "No papers found" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
  it("filters readable papers, sorts by title, and switches layout", () => {
    const { container } = render(<LibraryExplorer documents={documents} />);
    fireEvent.click(screen.getByRole("button", { name: /Ready to read/ }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Read" })).toHaveAttribute("href", "/documents/one/read");
    fireEvent.click(screen.getByRole("button", { name: /All papers/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Sort papers" }), { target: { value: "title" } });
    expect(within(screen.getAllByRole("article")[0]).getByRole("heading")).toHaveTextContent("Alpha research");
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(container.querySelector(".paper-collection-grid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
  });
});
