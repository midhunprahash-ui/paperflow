import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/docling-runtime", () => ({ requireDocling: vi.fn() }));
vi.mock("@/lib/azure-docling-queue", () => ({ azureDoclingEnabled: vi.fn(() => true), enqueueDoclingDocument: vi.fn() }));
vi.mock("@/lib/docling-processing", () => ({ processDoclingDocument: vi.fn(), runParameters: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { azureDoclingEnabled, enqueueDoclingDocument } from "./azure-docling-queue";
import { POST } from "@/app/api/documents/[documentId]/dispatch/route";

const ownerId = "e6b25c41-f16a-4abc-83b8-f55d46b32e01";
function setup(options: { authenticated?: boolean; document?: boolean; job?: boolean; state?: string; reserved?: boolean } = {}) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: options.document === false ? null : { id: 4, source_type: "pdf" } }),
    maybeSingle: vi.fn().mockResolvedValue({ data: options.job === false ? null : { status: options.state ?? "queued", heartbeat_at: new Date().toISOString() } }),
  };
  const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.authenticated === false ? null : { id: ownerId } } }) }, from: vi.fn(() => query) };
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  const reservation = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: options.reserved === false ? null : { id: 5 } }) };
  vi.mocked(createAdminClient).mockReturnValue({ from: () => reservation } as unknown as ReturnType<typeof createAdminClient>);
  return query;
}
const dispatch = () => POST(new Request("http://localhost/api/documents/4/dispatch", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: 5 }),
}), { params: Promise.resolve({ documentId: "4" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(azureDoclingEnabled).mockReturnValue(true);
  vi.mocked(enqueueDoclingDocument).mockResolvedValue(undefined);
});
describe("Azure dispatch authorization and acceptance", () => {
  it("rejects anonymous requests before sending work", async () => {
    setup({ authenticated: false });
    expect((await dispatch()).status).toBe(401);
    expect(enqueueDoclingDocument).not.toHaveBeenCalled();
  });
  it("rejects inaccessible documents and mismatched jobs", async () => {
    setup({ document: false });
    expect((await dispatch()).status).toBe(404);
    setup({ job: false });
    expect((await dispatch()).status).toBe(404);
    expect(enqueueDoclingDocument).not.toHaveBeenCalled();
  });
  it("uses authenticated ownership rather than client-supplied ownership", async () => {
    const query = setup();
    expect((await dispatch()).status).toBe(202);
    expect(query.eq).toHaveBeenCalledWith("owner_id", ownerId);
    expect(query.eq).toHaveBeenCalledWith("document_id", 4);
    expect(enqueueDoclingDocument).toHaveBeenCalledWith({ version: 1, documentId: 4, jobId: 5, ownerId });
  });
  it("does not report acceptance when Azure rejects the send", async () => {
    setup();
    vi.mocked(enqueueDoclingDocument).mockRejectedValue(new Error("queue unavailable"));
    expect((await dispatch()).status).toBe(503);
  });
  it("does not enqueue a live claim or completed job", async () => {
    setup({ state: "processing" });
    expect((await dispatch()).status).toBe(202);
    setup({ state: "ready" });
    expect((await dispatch()).status).toBe(202);
    expect(enqueueDoclingDocument).not.toHaveBeenCalled();
  });
});

it("does not enqueue a queued job already reserved by another tab or process", async () => {
  setup({ reserved: false });
  expect((await dispatch()).status).toBe(202);
  expect(enqueueDoclingDocument).not.toHaveBeenCalled();
});
