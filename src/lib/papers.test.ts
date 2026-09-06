import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPaper } from "./papers";
import { demoPaper } from "./demo";
const document = { id: 7, document_ref: "doc_7", source_path: "owner/documents/doc_7/source.pdf", active_version_id: 8, published_version_id: 9 };
const root = "owner/documents/doc_7/runs/run/";
function fixture(paper = structuredClone(demoPaper), denied = false) {
  const single = vi.fn().mockResolvedValue({ data: { manifest_path: root + "manifest.json" } });
  const eq = vi.fn().mockReturnThis();
  const download = vi.fn().mockResolvedValue(denied ? { error: new Error("Denied") } : { data: { text: async () => JSON.stringify(paper) } });
  const createSignedUrls = vi.fn(async (paths: string[]) => ({ data: paths.map(path => ({ path, signedUrl: "https://storage.test/" + path })) }));
  const client = { from: () => ({ select: () => ({ eq, single }) }), storage: { from: () => ({ download, createSignedUrls }) } } as unknown as SupabaseClient;
  return { client, download, createSignedUrls, eq };
}
describe("paper loading", () => {
  it("downloads the authorized manifest and batches original PDF signing", async () => {
    const { client, download, createSignedUrls, eq } = fixture();
    const result = await loadPaper(client, document);
    expect(download).toHaveBeenCalledWith(root + "manifest.json");
    expect(eq.mock.calls).toEqual([["id", 8], ["document_id", 7]]);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(result?.originalUrl).toContain(document.source_path);
    expect(result?.paper.sections).toHaveLength(demoPaper.sections.length);
  });
  it("signs v2 assets and the original in the same request", async () => {
    const paper = structuredClone(demoPaper); paper.schemaVersion = 2;
    paper.assets = { figure: { path: root + "figure.png", mediaType: "image/png", sha256: "a".repeat(64) } };
    const { client, createSignedUrls } = fixture(paper);
    const result = await loadPaper(client, document, true);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls.mock.calls[0][0]).toContain(root + "figure.png");
    expect(createSignedUrls.mock.calls[0][0]).toContain(document.source_path);
    expect(result?.paper.assets?.figure.url).toContain(root + "figure.png");
  });
  it("rejects cross-document v2 assets before signing", async () => {
    const paper = structuredClone(demoPaper); paper.schemaVersion = 2;
    paper.assets = { figure: { path: "other-owner/figure.png", mediaType: "image/png", sha256: "a".repeat(64) } };
    const { client, createSignedUrls } = fixture(paper);
    expect(await loadPaper(client, document)).toBeNull();
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
  it("does not sign any assets when Storage denies manifest access", async () => {
    const { client, createSignedUrls } = fixture(undefined, true);
    expect(await loadPaper(client, document)).toBeNull();
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});
