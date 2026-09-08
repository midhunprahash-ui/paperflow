import { createClient } from "@/lib/supabase/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const id = Number(documentId);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Invalid document" }, { status: 400 });
  const supabase = await createClient();
  if (!supabase) return Response.json({ error: "Service not configured" }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: document } = await supabase.from("documents").select("id,owner_id,deleted_at").eq("id", id).eq("owner_id", auth.user.id).single();
  if (!document) return Response.json({ error: "Not found" }, { status: 404 });
  if (document.deleted_at) return new Response(null, { status: 204 });
  const { error: markError } = await supabase.rpc("request_document_deletion", { p_document_id: id });
  if (markError) return Response.json({ error: "Could not start deletion" }, { status: 409 });

  // Retain the original, parsed assets, versions and job history for recovery.
  return new Response(null, { status: 204 });
}
