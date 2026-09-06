import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
import { processCloudflareDocument } from "./cloudflare-processing";

const run = { documentId: 4, jobId: 5, ownerId: "owner", runId: "run" };
const pdf = Buffer.from("%PDF-1.3 example");

function mockAdmin() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
  const update = vi.fn();
  const admin = {
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        is: vi.fn(() => query),
        update: vi.fn((value) => { update(value); return query; }),
        single: vi.fn().mockResolvedValue({ data: { id: 4, document_ref: "doc_4", title: "Paper", authors: [], source_type: "pdf", source_path: "owner/documents/doc_4/source.pdf", source_filename: "paper.pdf", source_byte_size: pdf.length }, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: table === "processing_jobs" ? { id: 5 } : null, error: null }),
      };
      return query;
    }),
    storage: { from: vi.fn(() => ({
      download: vi.fn().mockResolvedValue({ data: { size: pdf.length, arrayBuffer: async () => pdf }, error: null }),
      upload, remove,
    })) },
    rpc,
  };
  return { admin: admin as unknown as SupabaseClient, upload, remove, rpc, update };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Cloudflare processing", () => {
  it("pins the free parser, saves raw output and a manifest, then finalizes the owner-scoped job", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "secret-test-key");
    const request = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ choices: [{ message: { annotations: [
      { type: "file", file: { content: [{ type: "text", text: "### Page 1\nPaper text." }] } },
    ] } }], usage: { cost: 0 } }) });
    vi.stubGlobal("fetch", request);
    const mock = mockAdmin();
    await processCloudflareDocument(mock.admin, run);
    const payload = JSON.parse(request.mock.calls[0][1].body);
    expect(payload.model).toBe("openrouter/free");
    expect(payload.plugins).toEqual([{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }]);
    expect(payload.messages[0].content[1].file.file_data).toBe(`data:application/pdf;base64,${pdf.toString("base64")}`);
    expect(mock.upload.mock.calls.map((call) => call[0])).toEqual([
      "owner/documents/doc_4/runs/run/extraction.json", "owner/documents/doc_4/runs/run/manifest.json",
    ]);
    expect(mock.rpc).toHaveBeenCalledWith("finish_cloudflare_job", expect.objectContaining({
      p_job_id: 5, p_document_id: 4, p_owner_id: "owner", p_run_id: "run", p_page_count: 1,
    }));
    expect(mock.remove).not.toHaveBeenCalled();
  });

  it("records rate limiting without saving provider bodies or trying paid fallbacks", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "secret-test-key");
    const request = vi.fn().mockResolvedValue({ status: 429 });
    vi.stubGlobal("fetch", request);
    const mock = mockAdmin();
    await processCloudflareDocument(mock.admin, run);
    expect(request).toHaveBeenCalledTimes(1);
    expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.rpc).toHaveBeenCalledWith("fail_cloudflare_job", expect.objectContaining({
      p_message: "The free parser is busy or its daily limit was reached. Please retry later.",
    }));
  });
});
