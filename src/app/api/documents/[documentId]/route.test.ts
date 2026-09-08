import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), single: vi.fn(), eq: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, from: () => ({ select: () => ({ eq: mocks.eq, single: mocks.single }) }), rpc: mocks.rpc }) }));
import { DELETE } from "./route";
const remove = (id = "7") => DELETE(new Request("https://paper.test/api/documents/" + id, { method: "DELETE" }), { params: Promise.resolve({ documentId: id }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.eq.mockReturnThis();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
  mocks.single.mockResolvedValue({ data: { id: 7, owner_id: "owner", deleted_at: null } });
  mocks.rpc.mockResolvedValue({ error: null });
});
describe("soft deletion", () => {
  it("marks only the owner's document and succeeds without an admin client or Storage deletion", async () => {
    expect((await remove()).status).toBe(204);
    expect(mocks.eq.mock.calls).toEqual([["id", 7], ["owner_id", "owner"]]);
    expect(mocks.rpc).toHaveBeenCalledWith("request_document_deletion", { p_document_id: 7 });
  });
  it("is safe to retry after the document was already soft deleted", async () => {
    mocks.single.mockResolvedValue({ data: { id: 7, deleted_at: "2026-09-08" } });
    expect((await remove()).status).toBe(204); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects unsigned requests", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await remove()).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects missing or foreign documents", async () => {
    mocks.single.mockResolvedValue({ data: null });
    expect((await remove()).status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not report success when marking fails", async () => {
    mocks.rpc.mockResolvedValue({ error: new Error("failed") });
    expect((await remove()).status).toBe(409);
  });
});
