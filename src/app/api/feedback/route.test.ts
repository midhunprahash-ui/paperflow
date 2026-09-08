import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }), createAdminClient: () => ({ rpc: mocks.rpc }) }));
import { POST } from "./route";
const payload = { id: "d5422651-601a-4f9b-a503-dc0c3b0ee591", name: "Visitor", email: "visitor@example.com", feedback: "Please add reading highlights." };
const send = (body: unknown = payload) => POST(new Request("https://paper.test/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
  mocks.rpc.mockResolvedValue({ data: "accepted", error: null });
});
describe("feedback submission", () => {
  it("saves guest identity with validated feedback", async () => {
    expect((await send()).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_feedback", { p_id: payload.id, p_name: "Visitor", p_email: payload.email, p_feedback: payload.feedback, p_user_id: null });
  });
  it("uses verified account identity instead of caller supplied names and email", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner", email: "REAL@example.com", user_metadata: { first_name: "First", last_name: "Last" } } } });
    expect((await send()).status).toBe(201);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_name: "First Last", p_email: "real@example.com", p_user_id: "owner" });
  });
  it("rejects invalid and oversized feedback before database access", async () => {
    expect((await send({ ...payload, feedback: " " })).status).toBe(400);
    expect((await send({ ...payload, feedback: "x".repeat(13000) })).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires a valid guest email", async () => {
    expect((await send({ ...payload, email: "invalid" })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not treat an auth outage as a guest session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError" } });
    expect((await send()).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reports database failures without pretending feedback was saved", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private error" } });
    const response = await send();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private error");
  });
  it("returns cooldown and submission conflict responses", async () => {
    mocks.rpc.mockResolvedValue({ data: "rate_limited", error: null });
    const response = await send(); expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("30");
    mocks.rpc.mockResolvedValue({ data: "conflict", error: null });
    expect((await send()).status).toBe(409);
  });
});
