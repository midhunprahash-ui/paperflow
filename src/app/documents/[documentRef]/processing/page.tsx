import { notFound } from "next/navigation";
import { ProcessingView } from "@/components/processing-view";
import { demoJob } from "@/lib/demo";
import { createClient } from "@/lib/supabase/server";
import type { ProcessingJob } from "@/lib/types/document";

type Props = { params: Promise<{ documentRef: string }>; searchParams: Promise<{ demo?: string }> };
export const dynamic = "force-dynamic";

export default async function ProcessingPage({ params, searchParams }: Props) {
  const [{ documentRef }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  if (!supabase) return <ProcessingView initialJob={demoJob} documentRef={documentRef} filename="research-paper.pdf" demo />;

  const { data: document } = await supabase.from("documents").select("id,document_ref,source_filename").eq("document_ref", documentRef).single();
  if (!document) notFound();
  const { data: job } = await supabase.from("processing_jobs").select("*").eq("document_id", document.id).order("created_at", { ascending: false }).limit(1).single();
  if (!job) notFound();
  return <ProcessingView initialJob={job as ProcessingJob} documentRef={documentRef} filename={document.source_filename} demo={query.demo === "1"} />;
}
