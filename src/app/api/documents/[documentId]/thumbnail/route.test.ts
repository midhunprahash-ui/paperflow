import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claims: vi.fn(), query: vi.fn(), eq: vi.fn(), is: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getClaims: mocks.claims },
  from: () => ({ select: () => ({ eq: mocks.eq, is: mocks.is, maybeSingle: mocks.query }) }),
  storage: { from: () => ({ download: mocks.download }) },
}) }));
import { GET } from "./route";
const get = () => GET(new Request("https://paper.test/api/documents/7/thumbnail"), { params: Promise.resolve({ documentId: "7" }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.eq.mockReturnThis(); mocks.is.mockReturnThis();
  mocks.claims.mockResolvedValue({ data: { claims: { sub: "owner" } } });
  mocks.query.mockResolvedValue({ data: { document_ref: "ref", source_type: "pdf" } });
  mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array([255, 216, 255])]), error: null });
});
it("serves only the existing small image with private session-varying browser caching", async () => {
  const response = await get();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, max-age=86400");
  expect(response.headers.get("vary")).toBe("Cookie");
  expect(mocks.eq.mock.calls).toEqual([["id", 7], ["owner_id", "owner"]]);
  expect(mocks.is).toHaveBeenCalledWith("deleted_at", null);
  expect(mocks.download).toHaveBeenCalledExactlyOnceWith("owner/documents/ref/preview-v1.png");
});
it("rejects unsigned requests before looking up or downloading documents", async () => {
  mocks.claims.mockResolvedValue({ data: null });
  expect((await get()).status).toBe(401);
  expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
});
it("never downloads a preview for another owner's or deleted document", async () => {
  mocks.query.mockResolvedValue({ data: null });
  expect((await get()).status).toBe(404); expect(mocks.download).not.toHaveBeenCalled();
});
it("does not cache missing previews or fall back to downloading a full PDF", async () => {
  mocks.download.mockResolvedValue({ data: null, error: {} });
  const response = await get();
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.download).toHaveBeenCalledTimes(1);
});
