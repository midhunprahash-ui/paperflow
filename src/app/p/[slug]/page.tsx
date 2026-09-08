import { notFound } from "next/navigation";
import { PaperReader } from "@/components/paper-reader";
import { loadPaper } from "@/lib/papers";
import { createAdminClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ slug: string }> };
export const dynamic = "force-dynamic";

export default async function PublicPaperPage({ params }: Props) {
  const { slug } = await params;
  const supabase = createAdminClient();
  if (!supabase) notFound();
  const { data: document } = await supabase.from("documents").select("id,document_ref,source_path,active_version_id,published_version_id").eq("public_slug", slug).eq("status", "published").is("deleted_at", null).single();
  if (!document) notFound();
  const result = await loadPaper(supabase, document, true);
  if (!result) notFound();
  return <PaperReader paper={result.paper} backHref="/" originalUrl={result.originalUrl} />;
}
