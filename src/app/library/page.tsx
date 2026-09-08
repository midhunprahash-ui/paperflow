import { redirect } from "next/navigation";
import { LibraryHeader } from "@/components/library-header";
import { LibraryExplorer } from "@/components/library-explorer";
import { UploadDialog } from "@/components/upload-dialog";
import { demoLibrary } from "@/lib/demo";
import { createClient } from "@/lib/supabase/server";
import type { LibraryDocument } from "@/lib/types/document";

export const metadata = { title: "My library" };
export const dynamic = "force-dynamic";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ q = "" }, supabase] = await Promise.all([searchParams, createClient()]);
  let email: string | undefined;
  let fullName: string | undefined;
  let documents: LibraryDocument[] = demoLibrary;
  if (supabase) {
    const { data: identity } = await supabase.auth.getClaims();
    if (!identity?.claims.sub) redirect("/auth/sign-in?next=%2Flibrary");
    email = typeof identity.claims.email === "string" ? identity.claims.email : undefined;
    const [{ data, error }, { data: profile }] = await Promise.all([
      supabase.from("documents").select("id,document_ref,title,authors,source_type,status,page_count,updated_at,active_version_id,public_slug").eq("owner_id", identity.claims.sub).is("deleted_at", null).order("updated_at", { ascending: false }),
      supabase.from("profiles").select("display_name").eq("id", identity.claims.sub).maybeSingle(),
    ]);
    const metadata = identity.claims.user_metadata;
    fullName = [metadata?.full_name, metadata?.name, profile?.display_name].find(value => typeof value === "string" && value.trim())?.trim();
    if (error) throw new Error("Your library could not be loaded. Please try again.");
    documents = (data ?? []) as LibraryDocument[];
  }
  return <main className="library-page"><LibraryHeader email={email} fullName={fullName} /><div className="workspace-main"><div className="library-content"><div className="library-title-row"><div><span className="eyebrow">A little less noise. A little more focus.</span><h1>Your library<span>.</span></h1><p>All your papers. Room to think.</p></div><UploadDialog /></div><LibraryExplorer documents={documents} initialQuery={q.trim().slice(0, 80)} /></div></div></main>;
}
