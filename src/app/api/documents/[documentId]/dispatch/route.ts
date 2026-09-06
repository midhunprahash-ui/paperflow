import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { processDoclingDocument, runParameters } from "@/lib/docling-processing";

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
  try { await requireDocling(); } catch { return Response.json({ error: "The local Docling parser is not configured." }, { status: 503 }); }
  const { data: document } = await supabase.from("documents").select("id,source_type").eq("id", id).eq("owner_id", userData.user.id).is("deleted_at", null).single();
  if (!document) return Response.json({ error: "Not found" }, { status: 404 });

  if (document.source_type !== "pdf") return Response.json({ error: "Upload a PDF to use this parser." }, { status: 400 });
  const run = { documentId: id, jobId: body.jobId, ownerId: userData.user.id, runId: randomUUID() };
  const { data: state, error } = await admin.rpc("claim_docling_job", runParameters(run));
  if (error) return Response.json({ error: "Processing could not start. Retry from the library." }, { status: 409 });
  if (state === "claimed") after(() => processDoclingDocument(admin, run));
  return Response.json({ accepted: true, state }, { status: 202 });
}
