import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaperDocument } from "@/lib/types/document";

type DocumentRow = { id: number; document_ref: string; source_path: string; active_version_id: number | null; published_version_id: number | null };

export async function loadPaper(supabase: SupabaseClient, document: DocumentRow, publicVersion = false) {
  const versionId = publicVersion ? document.published_version_id : document.active_version_id;
  if (!versionId) return null;
  const { data: version } = await supabase.from("document_versions").select("manifest_path").eq("id", versionId).single();
  if (!version?.manifest_path) return null;
  const { data: manifestLink } = await supabase.storage.from("research-documents").createSignedUrl(version.manifest_path, 300);
  if (!manifestLink?.signedUrl) return null;
  const response = await fetch(manifestLink.signedUrl, { cache: "no-store" });
  if (!response.ok) return null;
  const paper = (await response.json()) as PaperDocument;

  const assetPaths = paper.sections.filter((node) => node.type === "figure" && !node.assetUrl.startsWith("http")).map((node) => node.type === "figure" ? node.assetUrl : "");
  if (assetPaths.length) {
    const { data: signed } = await supabase.storage.from("research-documents").createSignedUrls(assetPaths, 300);
    const urlMap = new Map(signed?.map((entry, index) => [assetPaths[index], entry.signedUrl]) ?? []);
    paper.sections = paper.sections.map((node) => node.type === "figure" ? { ...node, assetUrl: urlMap.get(node.assetUrl) ?? node.assetUrl } : node);
  }
  const { data: original } = await supabase.storage.from("research-documents").createSignedUrl(document.source_path, 300);
  return { paper, originalUrl: original?.signedUrl };
}
