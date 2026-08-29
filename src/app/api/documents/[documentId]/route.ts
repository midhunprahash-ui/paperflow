import { createAdminClient, createClient } from "@/lib/supabase/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const id = Number(documentId);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Invalid document" }, { status: 400 });
  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) return Response.json({ error: "Service not configured" }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: document } = await supabase.from("documents").select("id,document_ref,owner_id").eq("id", id).eq("owner_id", auth.user.id).single();
  if (!document) return Response.json({ error: "Not found" }, { status: 404 });
  const { error: markError } = await supabase.rpc("request_document_deletion", { p_document_id: id });
  if (markError) return Response.json({ error: "Could not start deletion" }, { status: 409 });

  const prefix = `${auth.user.id}/documents/${document.document_ref}`;
  const paths = await listObjectPaths(admin, prefix);
  if (paths.length) {
    const { error } = await admin.storage.from("research-documents").remove(paths);
    if (error) return Response.json({ error: "Storage cleanup failed; deletion can be retried" }, { status: 502 });
  }
  const { error: deleteError } = await admin.from("documents").delete().eq("id", id).eq("owner_id", auth.user.id);
  if (deleteError) return Response.json({ error: "Database cleanup failed" }, { status: 500 });
  return new Response(null, { status: 204 });
}

async function listObjectPaths(admin: NonNullable<ReturnType<typeof createAdminClient>>, root: string) {
  const files: string[] = [];
  const pending = [root];
  while (pending.length) {
    const prefix = pending.pop()!;
    const { data, error } = await admin.storage.from("research-documents").list(prefix, { limit: 1000 });
    if (error) throw error;
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) files.push(path); else pending.push(path);
    }
  }
  return files;
}
