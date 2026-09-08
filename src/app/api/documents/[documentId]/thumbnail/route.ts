import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const missing = (status: number) => new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const id = Number((await params).documentId);
  if (!Number.isSafeInteger(id) || id <= 0) return missing(400);
  const supabase = await createClient();
  if (!supabase) return missing(404);
  const { data: identity } = await supabase.auth.getClaims();
  if (!identity?.claims.sub) return missing(401);
  const { data: document } = await supabase.from("documents").select("document_ref,source_type")
    .eq("id", id).eq("owner_id", identity.claims.sub).is("deleted_at", null).maybeSingle();
  if (!document || document.source_type !== "pdf") return missing(404);
  const { data, error } = await supabase.storage.from("research-documents")
    .download(`${identity.claims.sub}/documents/${document.document_ref}/preview-v1.png`);
  if (error || !data) return missing(404);
  // Already-sized previews are browser cached, never shared through a public
  // image optimizer or CDN. Cookie variation separates signed-in sessions.
  return new Response(data, { headers: {
    "Content-Type": "image/png", "Content-Length": String(data.size),
    "Cache-Control": "private, max-age=86400", Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  } });
}
