import { notFound } from "next/navigation";
import { PaperReader } from "@/components/paper-reader";
import { loadPaper } from "@/lib/papers";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ documentRef: string }> };
export const dynamic = "force-dynamic";

export default async function ReadPage({ params }: Props) {
  const { documentRef } = await params;
  const supabase = await createClient();
  if (!supabase) notFound();
  const { data: document } = await supabase.from("documents").select("id,document_ref,source_path,active_version_id,published_version_id").eq("document_ref", documentRef).single();
  if (!document) notFound();
  const result = await loadPaper(supabase, document);
  if (!result) notFound();
  return <PaperReader paper={result.paper} originalUrl={result.originalUrl} />;
}
