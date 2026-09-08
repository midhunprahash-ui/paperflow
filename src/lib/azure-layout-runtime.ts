import "server-only";
import { DefaultAzureCredential } from "@azure/identity";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { DoclingError } from "./docling-runtime";

const execute = promisify(execFile);
const credential = new DefaultAzureCredential();
export function azureLayoutEnabled() {
  const value = process.env.DOCUMENT_PARSER ?? "docling";
  if (!["docling", "azure-layout"].includes(value)) throw new DoclingError("Invalid document parser configuration.");
  return value === "azure-layout";
}
export function azureLayoutEndpoint() {
  const url = new URL(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ?? "");
  if (url.protocol !== "https:" || !url.hostname.endsWith(".cognitiveservices.azure.com") || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") {
    throw new DoclingError("Invalid Azure document service endpoint.");
  }
  return url;
}
export function checkedOperation(location: string, endpoint: URL) {
  const url = new URL(location);
  if (url.origin !== endpoint.origin || url.username || url.password || !url.pathname.startsWith("/documentintelligence/documentModels/prebuilt-layout/analyzeResults/")) {
    throw new DoclingError("Azure returned an invalid analysis location.");
  }
  return url;
}

export async function runAzureLayout(input: string, output: string, signal?: AbortSignal) {
  const endpoint = azureLayoutEndpoint();
  const deadline = AbortSignal.any([AbortSignal.timeout(12 * 60_000), ...(signal ? [signal] : [])]);
  const token = await credential.getToken("https://cognitiveservices.azure.com/.default", { abortSignal: deadline });
  const headers = { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" };
  const request = new URL("/documentintelligence/documentModels/prebuilt-layout:analyze", endpoint);
  request.search = new URLSearchParams({ "api-version": "2024-11-30", outputContentFormat: "markdown", features: "formulas", stringIndexType: "unicodeCodePoint" }).toString();
  const submitted = await fetch(request, { method: "POST", headers, redirect: "error", signal: deadline,
    body: JSON.stringify({ base64Source: (await readFile(input)).toString("base64") }) });
  if (submitted.status !== 202) throw new DoclingError("Azure could not accept this PDF. Please retry shortly.");
  const location = submitted.headers.get("operation-location");
  if (!location) throw new DoclingError("Azure did not return an analysis reference.");
  const operation = checkedOperation(location, endpoint);
  let result: { status: string; analyzeResult?: unknown };
  for (;;) {
    await delay(2000, undefined, { signal: deadline });
    const response = await fetch(operation, { headers, redirect: "error", signal: deadline });
    if (response.status === 429 || response.status >= 500) {
      await delay(5000, undefined, { signal: deadline });
      continue;
    }
    if (!response.ok) throw new DoclingError("Azure analysis could not be retrieved. Please retry.");
    result = await response.json();
    if (result.status === "succeeded") break;
    if (!["running", "notStarted"].includes(result.status)) throw new DoclingError("Azure could not extract this PDF. Please try another file.");
  }
  const raw = path.join(path.dirname(input), "azure-result.json");
  await writeFile(raw, JSON.stringify(result), { mode: 0o600 });
  await execute(process.env.DOCLING_PYTHON!, [process.env.AZURE_LAYOUT_SCRIPT ?? path.resolve("docling-lab/azure_export.py"), input, raw, output], {
    timeout: 120_000, signal: deadline, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME },
  });
  await writeFile(path.join(output, "raw.json"), JSON.stringify(result), { mode: 0o600 });
}
