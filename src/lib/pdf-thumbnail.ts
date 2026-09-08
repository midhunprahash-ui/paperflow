import "server-only";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";

const execute = promisify(execFile);

export async function ensurePdfThumbnail(admin: SupabaseClient, input: string, prefix: string) {
  const storage = admin.storage.from("research-documents");
  const destination = `${prefix}preview-v1.png`;
  // storage-js returns data:false plus a 400/404 error for a missing object;
  // other failures throw. A missing preview is the normal first-upload case.
  const { data: exists } = await storage.exists(destination);
  if (exists) return;
  const python = process.env.DOCLING_PYTHON;
  if (!python) throw new Error("Missing preview renderer");
  const script = path.join(path.dirname(process.env.DOCLING_SCRIPT ?? "docling-lab/app_parse.py"), "pdf_thumbnail.py");
  const { stdout } = await execute(python, [script, input], {
    encoding: "buffer", timeout: 10_000, killSignal: "SIGKILL", maxBuffer: 128 * 1024,
    env: { PATH: process.env.PATH, LANG: "C.UTF-8", NODE_ENV: process.env.NODE_ENV },
  });
  if (!stdout.length || stdout.length > 128 * 1024 || stdout.subarray(0, 4).toString("hex") !== "89504e47") {
    throw new Error("Invalid PDF preview");
  }
  const { error } = await storage.upload(destination, stdout, {
    contentType: "image/png", cacheControl: "86400", upsert: false,
  });
  // A competing owned attempt may have already created the immutable preview.
  if (error && error.message !== "The resource already exists") throw new Error("Could not save PDF preview");
}
