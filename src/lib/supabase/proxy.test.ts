import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { getClaims, createServerClient } = vi.hoisted(() => ({ getClaims: vi.fn(), createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("./config", () => ({ isSupabaseConfigured: true, supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "test" }));
import { updateSession } from "./proxy";
beforeEach(() => {
  vi.clearAllMocks();
  createServerClient.mockReturnValue({ auth: { getClaims } });
});
describe("verified session routing", () => {
  it("rejects missing or invalid claims on private routes", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("Invalid token") });
    const response = await updateSession(new NextRequest("http://localhost/library"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/auth/sign-in?next=%2Flibrary");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("allows verified identities and redirects signed-in users away from sign-in", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "owner" } } });
    expect((await updateSession(new NextRequest("http://localhost/library"))).status).toBe(200);
    const response = await updateSession(new NextRequest("http://localhost/auth/sign-in"));
    expect(response.headers.get("location")).toBe("http://localhost/library");
  });
  it("preserves refreshed cookies and cache headers", async () => {
    createServerClient.mockImplementation((_url, _key, options) => ({ auth: { getClaims: async () => {
      options.cookies.setAll([{ name: "refreshed-session", value: "fixture", options: { httpOnly: true } }], { "Cache-Control": "private, no-store", "Pragma": "no-cache" });
      return { data: { claims: { sub: "owner" } } };
    } } }));
    const response = await updateSession(new NextRequest("http://localhost/library"));
    expect(response.cookies.get("refreshed-session")?.value).toBe("fixture");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
