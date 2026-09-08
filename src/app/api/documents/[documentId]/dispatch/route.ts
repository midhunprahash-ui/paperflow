import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { processDoclingDocument, runParameters } from "@/lib/docling-processing";
import { azureDoclingEnabled, enqueueDoclingDocument } from "@/lib/azure-docling-queue";

export const runtime = "nodejs";
export const maxDuration = 900;
import { requireDocling } from "@/lib/docling-runtime";

export async function POST(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const id = Number(documentId);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Invalid document" }, { status: 400 });

  const supabase = await createClient();
  if (!supabase) return Response.json({ accepted: true, demo: true }, { status: 202 });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  if (!Number.isSafeInteger(body?.jobId) || body.jobId <= 0) return Response.json({ error: "Invalid job" }, { status: 400 });
  const admin = createAdminClient();
  if (!admin) return Response.json({ error: "The parser is not configured." }, { status: 503 });
  try { await requireDocling(); } catch { return Response.json({ error: "The document parser is not configured." }, { status: 503 }); }
  const { data: document } = await supabase.from("documents").select("id,source_type").eq("id", id).eq("owner_id", userData.user.id).is("deleted_at", null).single();
  if (!document) return Response.json({ error: "Not found" }, { status: 404 });

  if (document.source_type !== "pdf") return Response.json({ error: "Upload a PDF to use this parser." }, { status: 400 });
  let queued: boolean;
  try { queued = azureDoclingEnabled(); }
  catch { return Response.json({ error: "The parser is not configured." }, { status: 503 }); }
  if (queued) {
    const { data: job, error: jobError } = await supabase.from("processing_jobs")
      .select("status,heartbeat_at").eq("id", body.jobId).eq("document_id", id).eq("owner_id", userData.user.id).maybeSingle();
    if (jobError || !job) return Response.json({ error: "Not found" }, { status: 404 });
    if (job.status === "ready" || (job.status === "processing" && Date.parse(job.heartbeat_at) > Date.now() - 300_000)) {
      return Response.json({ accepted: true, state: job.status }, { status: 202 });
    }
    if (job.status !== "queued" && job.status !== "processing") {
      return Response.json({ error: "Create a new processing attempt." }, { status: 409 });
    }
    // A queued job's heartbeat is a short dispatch lease. This conditional
    // database update admits one sender across tabs, processes and restarts.
    // Processing heartbeats belong to the worker and must not be changed here.
    const dispatchAt = new Date().toISOString();
    if (job.status === "queued") {
      const cutoff = new Date(Date.now() - 120_000).toISOString();
      const { data: reserved, error: reserveError } = await admin.from("processing_jobs")
        .update({ heartbeat_at: dispatchAt }).eq("id", body.jobId).eq("document_id", id)
        .eq("owner_id", userData.user.id).eq("status", "queued")
        .or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`).select("id").maybeSingle();
      if (reserveError) return Response.json({ error: "Processing could not be scheduled. Please retry." }, { status: 503 });
      if (!reserved) return Response.json({ accepted: true, state: "queued" }, { status: 202 });
    }
    try {
      await enqueueDoclingDocument({ version: 1, documentId: id, jobId: body.jobId, ownerId: userData.user.id });
    } catch {
      if (job.status === "queued") {
        // Release only our reservation; never overwrite a worker's newer lease.
        await admin.from("processing_jobs").update({ heartbeat_at: job.heartbeat_at ?? null })
          .eq("id", body.jobId).eq("document_id", id).eq("owner_id", userData.user.id)
          .eq("status", "queued").eq("heartbeat_at", dispatchAt);
      }
      return Response.json({ error: "Processing could not be scheduled. Please retry." }, { status: 503 });
    }
    return Response.json({ accepted: true, state: "queued" }, { status: 202 });
  }
  const run = { documentId: id, jobId: body.jobId, ownerId: userData.user.id, runId: randomUUID() };
  const { data: state, error } = await admin.rpc("claim_docling_job", runParameters(run));
  if (error) return Response.json({ error: "Processing could not start. Retry from the library." }, { status: 409 });
  if (state === "claimed") after(() => processDoclingDocument(admin, run));
  return Response.json({ accepted: true, state }, { status: 202 });
}
