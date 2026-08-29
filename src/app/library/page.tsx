import { LibraryCard } from "@/components/library-card";
import { LibraryHeader } from "@/components/library-header";
import { UploadDialog } from "@/components/upload-dialog";
import { demoLibrary } from "@/lib/demo";
import { createClient } from "@/lib/supabase/server";
import type { LibraryDocument } from "@/lib/types/document";

export const metadata = { title: "My library" };
export const dynamic = "force-dynamic";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const normalizedQuery = q.trim().slice(0, 80);
  const supabase = await createClient();
  const { data: authData } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  let documents = demoLibrary;
  if (supabase && authData.user) {
    let request = supabase.from("documents").select("id,document_ref,title,authors,source_type,status,page_count,updated_at,active_version_id,public_slug").is("deleted_at", null).order("updated_at", { ascending: false });
    if (normalizedQuery) request = request.ilike("title", `%${normalizedQuery.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
    const { data } = await request;
    documents = (data ?? []) as LibraryDocument[];
  } else if (normalizedQuery) {
    const needle = normalizedQuery.toLowerCase();
    documents = documents.filter((document) => `${document.title} ${document.authors.join(" ")}`.toLowerCase().includes(needle));
  }

  return <main className="library-page"><LibraryHeader email={authData.user?.email} query={normalizedQuery} /><div className="library-content"><div className="library-title-row"><div><span className="eyebrow">Personal collection</span><h1>Your library</h1><p>{documents.length ? `${documents.length} papers, ready whenever you are.` : normalizedQuery ? "No papers match that search." : "Your reading shelf is waiting for its first paper."}</p></div><UploadDialog /></div>{documents.length ? <section className="library-grid" aria-label="Your research papers">{documents.map((document) => <LibraryCard key={document.id} document={document} />)}</section> : <section className="empty-library"><UploadDialog /><h2>{normalizedQuery ? "No matching papers" : "Add your first paper"}</h2><p>{normalizedQuery ? "Try a different title or add a new paper." : "Upload a PDF or DOCX to create a beautiful reading version."}</p></section>}</div></main>;
}
