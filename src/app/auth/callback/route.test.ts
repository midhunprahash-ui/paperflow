import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { exchange } = vi.hoisted(() => ({ exchange: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }) }));
import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://papers.example.com");
  vi.stubEnv("SITE_URL", "");
  vi.stubEnv("AUTH_REDIRECT_ORIGINS", "");
  exchange.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("OAuth callback redirects", () => {
  it("uses the runtime custom domain and keeps the session on that domain", async () => {
    vi.stubEnv("SITE_URL", "https://randomwebsite.website");
    const response = await GET(new NextRequest("https://0.0.0.0:3000/auth/callback?code=valid", {
      headers: { "x-forwarded-host": "randomwebsite.website" },
    }));
    expect(response.headers.get("location")).toBe("https://randomwebsite.website/library");
  });
  it("keeps existing Azure-host sessions on their allowlisted origin", async () => {
    vi.stubEnv("SITE_URL", "https://randomwebsite.website");
    vi.stubEnv("AUTH_REDIRECT_ORIGINS", "https://legacy.example.com");
    const response = await GET(new NextRequest("https://0.0.0.0:3000/auth/callback?code=valid", {
      headers: { "x-forwarded-host": "legacy.example.com" },
    }));
    expect(response.headers.get("location")).toBe("https://legacy.example.com/library");
  });
  it("ignores an attacker host and uses the configured custom domain", async () => {
    vi.stubEnv("SITE_URL", "https://randomwebsite.website");
    const response = await GET(new NextRequest("https://0.0.0.0:3000/auth/callback?code=valid", {
      headers: { "x-forwarded-host": "randomwebsite.website.attacker.example" },
    }));
    expect(response.headers.get("location")).toBe("https://randomwebsite.website/library");
  });
  it("exchanges the code and redirects from the internal container to the public library", async () => {
    const response = await GET(new NextRequest("https://0.0.0.0:3000/auth/callback?code=valid", {
      headers: { "x-forwarded-host": "attacker.example" },
    }));
    expect(exchange).toHaveBeenCalledWith("valid");
    expect(response.headers.get("location")).toBe("https://papers.example.com/library");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each(["https://attacker.example", "//attacker.example", "/\\attacker.example", "/\n/attacker.example"])("rejects external next destinations: %s", async next => {
    const response = await GET(new NextRequest(`https://0.0.0.0:3000/auth/callback?code=valid&next=${encodeURIComponent(next)}`));
    expect(response.headers.get("location")).toBe("https://papers.example.com/library");
  });
  it("preserves the password recovery destination", async () => {
    const response = await GET(new NextRequest("https://0.0.0.0:3000/auth/callback?code=valid&next=/auth/reset-password"));
    expect(response.headers.get("location")).toBe("https://papers.example.com/auth/reset-password");
  });
  it.each([null, "expired"])("returns a useful sign-in error for missing or invalid codes: %s", async code => {
    exchange.mockResolvedValue({ error: new Error("Invalid code") });
    const response = await GET(new NextRequest(`https://0.0.0.0:3000/auth/callback${code ? "?code=" + code : ""}`));
    expect(response.headers.get("location")).toBe("https://papers.example.com/auth/sign-in?error=oauth_callback_failed&next=%2Flibrary");
    expect(exchange).toHaveBeenCalledTimes(code ? 1 : 0);
  });
  it("keeps development redirects on the actual localhost port", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await GET(new NextRequest("http://localhost:3001/auth/callback?code=valid"));
    expect(response.headers.get("location")).toBe("http://localhost:3001/library");
  });
});
