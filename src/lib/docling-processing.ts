import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PaperDocument } from "./types/document";
import { DoclingError, runDocling, validatePdf, readLocalAsset } from "./docling-runtime";

const BUCKET = "research-documents";
export type DoclingRun = { documentId: number; jobId: number; ownerId: string; runId: string };
export const runParameters = (run: DoclingRun) => ({
  p_document_id: run.documentId, p_job_id: run.jobId, p_owner_id: run.ownerId, p_run_id: run.runId,
});

class ProcessingError extends DoclingError {}

export async function processDoclingDocument(admin: SupabaseClient, run: DoclingRun) {
  const uploaded: string[] = [];
  let completed = false;
  let directory: string | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const controller = new AbortController();
  try {
    const { data: document, error } = await admin.from("documents")
      .select("id,document_ref,title,authors,source_filename,source_type,source_path,source_byte_size")
      .eq("id", run.documentId).eq("owner_id", run.ownerId).is("deleted_at", null).single();
    if (error || !document) throw new ProcessingError("The document is no longer available.");
    const prefix = `${run.ownerId}/documents/${document.document_ref}/`;
    if (document.source_type !== "pdf" || !document.source_path?.startsWith(prefix)) {
      throw new ProcessingError("Upload a PDF to use this parser.");
    }
    const { data: file, error: downloadError } = await admin.storage.from(BUCKET).download(document.source_path);
    if (downloadError || !file) throw new ProcessingError("The original PDF could not be downloaded.");
    if (!file.size || file.size > 25 * 1024 * 1024 || file.size !== document.source_byte_size) {
      throw new ProcessingError("The uploaded file is incomplete or exceeds 25 MB.");
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new ProcessingError("This file is not a valid PDF.");
    await validatePdf(bytes);
    await progress(admin, run, "layout", 20);
    let heartbeatPending = false;
    heartbeat = setInterval(() => {
      if (heartbeatPending) return;
      heartbeatPending = true;
      void progress(admin, run, "layout", 20).catch(() => controller.abort()).finally(() => { heartbeatPending = false; });
    }, 20_000);
    directory = await mkdtemp(path.join(tmpdir(), "rpaper-docling-"));
    const input = path.join(directory, "source.pdf");
    const output = path.join(directory, "output");
    await writeFile(input, bytes, { mode: 0o600 });
    await runDocling(input, ["--output", output], 15 * 60_000, controller.signal);
    clearInterval(heartbeat); heartbeat = undefined;
    const paper = JSON.parse(await readFile(path.join(output, "app-manifest.json"), "utf8")) as PaperDocument;
    if (paper.schemaVersion !== 2 || !paper.sections.length || paper.source.checksum !== createHash("sha256").update(bytes).digest("hex")) {
      throw new ProcessingError("The parser output could not be verified.");
    }
    paper.source.filename = document.source_filename;
    await progress(admin, run, "assembling", 75);
    const outputRoot = `${prefix}runs/${run.runId}`;
    const assetEntries = Object.values(paper.assets ?? {});
    for (const asset of assetEntries) {
      const data = await readLocalAsset(output, asset.path);
      if (createHash("sha256").update(data).digest("hex") !== asset.sha256) throw new ProcessingError("An extracted image failed verification.");
      asset.path = `${outputRoot}/${asset.path}`;
      const { error: assetError } = await admin.storage.from(BUCKET).upload(asset.path, data, { contentType: "image/png", upsert: false });
      if (assetError) throw new ProcessingError("An extracted image could not be saved. Please retry.");
      uploaded.push(asset.path);
      await progress(admin, run, "assets", 80);
    }
    for (const name of ["raw.json", "document.json", "structure.json", "inline-content.json", "source-fragments.json", "table-content.json", "quality.json", "ocr-lines.json", "formula-candidates.json", "paper-markdown.json", "manifest.json"]) {
      const content = name === "manifest.json" ? JSON.stringify(paper) : name === "paper-markdown.json" ? JSON.stringify({ markdown: await readFile(path.join(output, "paper.md"), "utf8") }) : await readFile(path.join(output, name));
      const storagePath = `${outputRoot}/${name}`;
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, content, {
        contentType: "application/json", upsert: false,
      });
      if (uploadError) throw new ProcessingError("The parsed document could not be saved. Please retry.");
      uploaded.push(storagePath);
    }
    await progress(admin, run, "quality_check", 95);
    const { error: finishError } = await admin.rpc("finish_docling_job", {
      ...runParameters(run), p_manifest_path: `${outputRoot}/manifest.json`,
      p_page_count: paper.metadata.pageCount, p_block_count: paper.sections.length,
      p_title: paper.metadata.title, p_assets: assetEntries,
      p_quality: { parser: "docling", schema_version: 2, review_required: true, section_count: paper.hierarchy?.length },
    });
    if (finishError) {
      // A lost HTTP response may follow a committed transaction. Verify before cleanup.
      const { data: version } = await admin.from("document_versions").select("id")
        .eq("document_id", run.documentId).eq("owner_id", run.ownerId)
        .eq("manifest_path", `${outputRoot}/manifest.json`).maybeSingle();
      if (!version) throw new ProcessingError("The reading copy could not be finalized. Please retry.");
    }
    completed = true;
  } catch (error) {
    // Never store provider error bodies, credentials, or source content in job errors.
    const message = error instanceof DoclingError ? error.message : "Document processing was interrupted. Please retry.";
    if (!completed) {
      // Keep artifacts if database availability prevents determining commit status.
      if (uploaded.length) {
        const manifest = uploaded.find((path) => path.endsWith("/manifest.json"));
        const { data: version, error: checkError } = await admin.from("document_versions").select("id")
          .eq("owner_id", run.ownerId).eq("manifest_path", manifest ?? "").maybeSingle();
        if (version) return;
        if (!checkError) await admin.storage.from(BUCKET).remove(uploaded);
      }
      const { error: failError } = await admin.rpc("fail_docling_job", { ...runParameters(run), p_message: message });
      if (failError) console.error("Could not record parser failure", { jobId: run.jobId });
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

async function progress(admin: SupabaseClient, run: DoclingRun, stage: string, percent: number) {
  const { data, error } = await admin.from("processing_jobs")
    .update({ stage, progress: percent, heartbeat_at: new Date().toISOString() })
    .eq("id", run.jobId).eq("document_id", run.documentId).eq("owner_id", run.ownerId)
    .eq("worker_job_id", run.runId).eq("status", "processing").select("id").maybeSingle();
  if (error || !data) throw new ProcessingError("This processing attempt is no longer active.");
}
