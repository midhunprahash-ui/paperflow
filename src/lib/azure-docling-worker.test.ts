import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueueClient } from "@azure/storage-queue";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./docling-processing", () => ({
  processDoclingDocument: vi.fn(),
  runParameters: (r: { documentId: number; jobId: number; ownerId: string; runId: string }) => ({
    p_document_id: r.documentId, p_job_id: r.jobId, p_owner_id: r.ownerId, p_run_id: r.runId,
  }),
}));
import { consumeDoclingMessage, drainDoclingQueue } from "./azure-docling-worker";
import { processDoclingDocument } from "./docling-processing";

const payload = { version: 1, documentId: 4, jobId: 5, ownerId: "e6b25c41-f16a-4abc-83b8-f55d46b32e01" };
function fixture(options: { state?: string; claim?: string; deleted?: boolean; dequeueCount?: number; malformed?: boolean } = {}) {
  let state = options.state ?? "queued";
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: { status: state }, error: null })),
  };
  const document = { ...query, maybeSingle: vi.fn(async () => ({ data: options.deleted ? null : { id: 4 }, error: null })) };
  const rpc = vi.fn(async (name: string) => {
    if (name === "fail_docling_job") state = "failed";
    else if ((options.claim ?? "claimed") === "claimed") state = "processing";
    return { data: options.claim ?? "claimed", error: null };
  });
  const admin = { from: vi.fn((table: string) => table === "documents" ? document : query), rpc };
  const queue = {
    receiveMessages: vi.fn().mockResolvedValue({ receivedMessageItems: [{
      messageId: "message", popReceipt: "receipt", dequeueCount: options.dequeueCount ?? 1,
      messageText: options.malformed ? "invalid" : JSON.stringify(payload),
    }] }),
    deleteMessage: vi.fn().mockResolvedValue({}), updateMessage: vi.fn().mockResolvedValue({}),
  };
  const poison = { sendMessage: vi.fn().mockResolvedValue({}) };
  const consume = () => consumeDoclingMessage(admin as unknown as SupabaseClient, queue as unknown as QueueClient, poison as unknown as QueueClient);
  return { consume, admin, queue, poison, rpc, query, setState: (value: string) => { state = value; } };
}

beforeEach(() => vi.resetAllMocks());
describe("Azure Docling delivery", () => {
  it("claims the owned identifiers and acknowledges only confirmed completion", async () => {
    const f = fixture();
    vi.mocked(processDoclingDocument).mockImplementation(async () => {
      expect(f.queue.deleteMessage).not.toHaveBeenCalled();
      f.setState("ready");
    });
    await expect(f.consume()).resolves.toBe("processed");
    expect(f.rpc).toHaveBeenCalledWith("claim_docling_job", expect.objectContaining({ p_owner_id: payload.ownerId, p_document_id: 4, p_job_id: 5 }));
    expect(f.queue.deleteMessage).toHaveBeenCalledWith("message", "receipt");
  });
  it("does not rerun a completed duplicate", async () => {
    const f = fixture({ state: "ready" });
    await f.consume();
    expect(processDoclingDocument).not.toHaveBeenCalled();
    expect(f.queue.deleteMessage).toHaveBeenCalled();
  });
  it("retains a duplicate while another execution owns the live lease", async () => {
    const f = fixture({ state: "processing", claim: "processing" });
    await expect(f.consume()).resolves.toBe("busy");
    expect(f.queue.deleteMessage).not.toHaveBeenCalled();
    expect(f.queue.updateMessage).toHaveBeenCalledWith("message", "receipt", undefined, 330);
    expect(processDoclingDocument).not.toHaveBeenCalled();
  });
  it("retains the message after a crash or unconfirmed database result", async () => {
    const f = fixture();
    vi.mocked(processDoclingDocument).mockResolvedValue(undefined);
    await expect(f.consume()).rejects.toThrow("not confirmed");
    expect(f.queue.deleteMessage).not.toHaveBeenCalled();
  });
  it("leaves deliveries untouched when the database is unavailable", async () => {
    const f = fixture();
    f.query.maybeSingle.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(f.consume()).rejects.toThrow();
    expect(f.queue.deleteMessage).not.toHaveBeenCalled();
  });
  it("does not process a deleted document", async () => {
    const f = fixture({ deleted: true });
    await expect(f.consume()).resolves.toBe("deleted");
    expect(processDoclingDocument).not.toHaveBeenCalled();
    expect(f.queue.deleteMessage).toHaveBeenCalled();
  });
  it("quarantines malformed messages before acknowledging", async () => {
    const f = fixture({ malformed: true });
    await expect(f.consume()).resolves.toBe("quarantined");
    expect(f.poison.sendMessage).toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("fails an exhausted attempt only after acquiring its lease", async () => {
    const f = fixture({ dequeueCount: 6 });
    await f.consume();
    expect(f.rpc.mock.calls.map(call => call[0])).toEqual(["claim_docling_job", "fail_docling_job"]);
    expect(f.poison.sendMessage).toHaveBeenCalled();
    expect(processDoclingDocument).not.toHaveBeenCalled();
    expect(f.queue.deleteMessage).toHaveBeenCalled();
  });
});

it("drains completed duplicates before processing fresh work in the same execution", async () => {
  const f = fixture({ state: "ready" });
  let receives = 0;
  f.queue.receiveMessages.mockImplementation(async () => {
    receives++;
    if (receives === 4) f.setState("queued");
    return { receivedMessageItems: [{ messageId: String(receives), popReceipt: "receipt", dequeueCount: 1, messageText: JSON.stringify(payload) }] };
  });
  vi.mocked(processDoclingDocument).mockImplementation(async () => { f.setState("ready"); });
  const result = await drainDoclingQueue(f.admin as unknown as SupabaseClient, f.queue as unknown as QueueClient, f.poison as unknown as QueueClient);
  expect(result).toEqual({ processed: 1, discarded: 3, deferred: 0 });
  expect(processDoclingDocument).toHaveBeenCalledTimes(1);
  expect(f.queue.deleteMessage).toHaveBeenCalledTimes(4);
});
it("bounds duplicate draining and exits immediately on an empty queue", async () => {
  const f = fixture({ state: "ready" });
  expect((await drainDoclingQueue(f.admin as unknown as SupabaseClient, f.queue as unknown as QueueClient, f.poison as unknown as QueueClient)).discarded).toBe(100);
  f.queue.receiveMessages.mockResolvedValue({ receivedMessageItems: [] });
  expect(await drainDoclingQueue(f.admin as unknown as SupabaseClient, f.queue as unknown as QueueClient, f.poison as unknown as QueueClient)).toEqual({ processed: 0, discarded: 0, deferred: 0 });
});
