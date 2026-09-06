import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaperDocument } from "@/lib/types/document";
import { manifestAssetPaths } from "./paper-assets";

type DocumentRow = { id: number; document_ref: string; source_path: string; active_version_id: number | null; published_version_id: number | null };

export async function loadPaper(supabase: SupabaseClient, document: DocumentRow, publicVersion = false) {
  const versionId = publicVersion ? document.published_version_id : document.active_version_id;
  if (!versionId) return null;
  const { data: version } = await supabase.from("document_versions").select("manifest_path").eq("id", versionId).eq("document_id", document.id).single();
  if (!version?.manifest_path) return null;
  const storage = supabase.storage.from("research-documents");
  // The authenticated download enforces Storage policy in one request. Signing
  // the manifest first added a redundant round trip before the paper could load.
  const { data: manifest, error } = await storage.download(version.manifest_path);
  if (error || !manifest) return null;
  const paper = JSON.parse(await manifest.text()) as PaperDocument;
  if (paper.schemaVersion !== 1 && paper.schemaVersion !== 2) return null;
  let paths: string[] = [];
  if (paper.schemaVersion === 2) {
    try { paths = manifestAssetPaths(paper, version.manifest_path); } catch { return null; }
  }
  const legacyPaths = paper.sections.flatMap(node => node.type === "figure" && node.assetUrl && !node.assetUrl.startsWith("http") ? [node.assetUrl] : []);
  const allPaths = [...new Set([...paths, ...legacyPaths, document.source_path].filter(Boolean))];
  // Sign the original and all images together; no per-image waterfall. These
  // private URLs are resolved afresh for each authorized request, never globally cached.
  const batches = await Promise.all(Array.from({ length: Math.ceil(allPaths.length / 100) }, async (_, i) => {
    const { data } = await storage.createSignedUrls(allPaths.slice(i * 100, (i + 1) * 100), 3600);
    return data ?? [];
  }));
  const urls = new Map(batches.flat().map(entry => [entry.path, entry.signedUrl]));
  for (const asset of Object.values(paper.assets ?? {})) asset.url = urls.get(asset.path) ?? undefined;
  paper.sections = paper.sections.map(node => node.type === "figure" && urls.has(node.assetUrl) ? { ...node, assetUrl: urls.get(node.assetUrl)! } : node);
  return { paper, originalUrl: urls.get(document.source_path) ?? undefined };
}
