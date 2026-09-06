import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./docling-runtime", async importOriginal => ({ ...(await importOriginal<object>()), validatePdf: vi.fn().mockResolvedValue({ pages: 1 }), runDocling: vi.fn() }));
import { processDoclingDocument } from "./docling-processing";
import { runDocling, validatePdf } from "./docling-runtime";

const run = { documentId: 4, jobId: 5, ownerId: "owner", runId: "run" };
const pdf = Buffer.from("%PDF-1.3 example");
const image = Buffer.from("local source image fixture");
function adminMock(active = true) {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
  const client = { from: vi.fn((table: string) => {
    const q = { select: vi.fn(() => q), eq: vi.fn(() => q), is: vi.fn(() => q), update: vi.fn(() => q),
      single: vi.fn().mockResolvedValue({ data: { document_ref: "doc_4", source_type: "pdf", source_path: "owner/documents/doc_4/source.pdf", source_filename: "original.pdf", source_byte_size: pdf.length }, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: table === "processing_jobs" && active ? { id: 5 } : null, error: null }) };
    return q;
  }), storage: { from: vi.fn(() => ({ upload, remove, download: vi.fn().mockResolvedValue({ data: { size: pdf.length, arrayBuffer: async () => pdf }, error: null }) })) }, rpc };
  return { admin: client as unknown as SupabaseClient, upload, remove, rpc };
}
async function outputFixture(_input: string, args: string[]) {
  const out = args[1]; await mkdir(path.join(out, "assets"), { recursive: true });
  await writeFile(path.join(out, "assets/image.png"), image);
  const paper = { schemaVersion: 2, metadata: { title: "Source title", pageCount: 1 }, source: { checksum: createHash("sha256").update(pdf).digest("hex") }, sections: [{ id: "p", type: "paragraph", text: "Original", order: 0 }], assets: { image: { path: "assets/image.png", sha256: createHash("sha256").update(image).digest("hex"), mediaType: "image/png" } }, hierarchy: [] };
  await writeFile(path.join(out, "app-manifest.json"), JSON.stringify(paper));
  for (const file of ["raw.json", "document.json", "structure.json", "inline-content.json", "source-fragments.json", "table-content.json", "quality.json", "ocr-lines.json", "formula-candidates.json", "paper.md"]) await writeFile(path.join(out, file), "{}");
  return { stdout: "", stderr: "" } as Awaited<ReturnType<typeof runDocling>>;
}
afterEach(() => vi.clearAllMocks());
describe("Local Docling processing", () => {
  it("saves source assets and typed output before atomically completing the owned run", async () => {
    vi.mocked(runDocling).mockImplementation(outputFixture);
    const mock = adminMock(); await processDoclingDocument(mock.admin, run);
    expect(validatePdf).toHaveBeenCalledWith(pdf);
    expect(mock.upload.mock.calls[0][0]).toBe("owner/documents/doc_4/runs/run/assets/image.png");
    const manifest = JSON.parse(mock.upload.mock.calls.find(call => call[0].endsWith("manifest.json"))![1]);
    expect(manifest.assets.image.path).toBe("owner/documents/doc_4/runs/run/assets/image.png");
    expect(manifest.source.filename).toBe("original.pdf");
    expect(mock.rpc).toHaveBeenCalledWith("finish_docling_job", expect.objectContaining({ p_run_id: "run", p_owner_id: "owner", p_title: "Source title", p_page_count: 1 }));
    expect(mock.remove).not.toHaveBeenCalled();
  });
  it("does not run inference when a job has lost its lease", async () => {
    const mock = adminMock(false); await processDoclingDocument(mock.admin, run);
    expect(runDocling).not.toHaveBeenCalled();
    expect(mock.rpc).toHaveBeenCalledWith("fail_docling_job", expect.objectContaining({ p_run_id: "run" }));
  });
  it("removes partial artifacts when upload fails before committing a version", async () => {
    vi.mocked(runDocling).mockImplementation(outputFixture);
    const mock = adminMock(); mock.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "failed" } });
    await processDoclingDocument(mock.admin, run);
    expect(mock.remove).toHaveBeenCalledWith(["owner/documents/doc_4/runs/run/assets/image.png"]);
    expect(mock.rpc).not.toHaveBeenCalledWith("finish_docling_job", expect.anything());
  });
});
