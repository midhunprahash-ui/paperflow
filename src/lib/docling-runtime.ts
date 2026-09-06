import "server-only";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export class DoclingError extends Error {}
export const doclingEnabled = () => process.env.DOCLING_ENABLED === "1";
const python = () => process.env.DOCLING_PYTHON!;

export async function requireDocling() {
  if (!doclingEnabled()) throw new DoclingError("Local document parsing is not enabled.");
  if (!process.env.DOCLING_PYTHON || !process.env.DOCLING_SCRIPT) throw new DoclingError("Configure the local Python interpreter and Docling entrypoint.");
  try { await access(python(), constants.X_OK); }
  catch { throw new DoclingError("The local parser environment is missing. Complete the Docling setup first."); }
}

export async function runDocling(input: string, args: string[], timeout: number, signal?: AbortSignal) {
  // Never pass API credentials to the PDF/model process or invoke a shell.
  const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "HF_HOME", "HF_HUB_CACHE"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
  return execute(python(), [process.env.DOCLING_SCRIPT!, input, ...args], {
    timeout, signal, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024,
    env: { ...env, NODE_ENV: process.env.NODE_ENV, OMP_NUM_THREADS: "2", TOKENIZERS_PARALLELISM: "false", ORT_DISABLE_TELEMETRY: "1" },
  });
}

export async function validatePdf(bytes: Buffer) {
  await requireDocling();
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new DoclingError("Choose a PDF up to 25 MB.");
  const dir = await mkdtemp(path.join(tmpdir(), "rpaper-preflight-"));
  try {
    const input = path.join(dir, "source.pdf"); await writeFile(input, bytes, { mode: 0o600 });
    try { const result = await runDocling(input, ["--validate"], 30_000); return JSON.parse(result.stdout) as { pages: number }; }
    catch (error) {
      if ((error as { code?: number }).code === 2) {
        const result = JSON.parse((error as { stdout: string }).stdout);
        throw new DoclingError(result.error);
      }
      throw new DoclingError("The PDF could not be validated. Try an unlocked PDF with 1–16 pages.");
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function readLocalAsset(root: string, relative: string) {
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep) || path.extname(resolved) !== ".png") throw new DoclingError("Invalid parser asset.");
  return readFile(resolved);
}
