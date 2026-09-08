import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
vi.mock("./docling-runtime", () => ({ DoclingError: class extends Error {}, readLocalAsset: vi.fn(async () => Buffer.from("image")) }));
import { uploadAssetBatch } from "./docling-processing";
it("waits for successful late uploads before failing a batch so cleanup sees every object", async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const upload = vi.fn(async (path: string) => {
    if (path.endsWith("bad.png")) return { error: {} };
    await pending;
    return { error: null };
  });
  const admin = { storage: { from: () => ({ upload }) } } as unknown as SupabaseClient;
  const sha256 = createHash("sha256").update("image").digest("hex");
  const uploaded: string[] = [];
  let settled = false;
  const result = uploadAssetBatch(admin, ["bad.png", "late.png"].map(path => ({ path, sha256, mediaType: "image/png" })), "/output", "owner/run", uploaded).catch(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  release(); await result;
  expect(settled).toBe(true);
  expect(uploaded).toEqual(["owner/run/late.png"]);
});
