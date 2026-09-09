"use client";

import { toast } from "sonner";
import { Brand } from "./brand";
import { ParsingAnimation } from "./parsing-animation";
import { BookOpen, Check, FileText, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ProcessingJob, ProcessingStage } from "@/lib/types/document";

const stages: { key: ProcessingStage; title: string; detail: string }[] = [
  { key: "validating", title: "Inspecting your document", detail: "Checking the uploaded PDF" },
  { key: "layout", title: "Reading the paper structure", detail: "Recovering sections, reading order, tables and scanned text. Parsing can take a few minutes." },
  { key: "assembling", title: "Building your reader", detail: "Creating the responsive ebook structure" },
  { key: "assets", title: "Preserving technical content", detail: "Saving figures, equations and source images" },
  { key: "quality_check", title: "Checking completeness", detail: "Checking the extracted pages and saving your reading copy" },
];

export function ProcessingView({ initialJob, documentRef, filename, demo = false }: { initialJob: ProcessingJob; documentRef: string; filename: string; demo?: boolean }) {
  const router = useRouter();
  const lastStatus = useRef(initialJob.status);
  const [job, setJob] = useState(initialJob);
  const [retrying, setRetrying] = useState(false);
  const activeIndex = stages.findIndex((stage) => stage.key === (["ocr", "tables_formulas"].includes(job.stage) ? "layout" : job.stage));
  const parsingStep = job.stage === "queued" ? -1 : activeIndex <= 0 ? 0 : activeIndex === 1 ? 1 : 2;

  useEffect(() => {
    if (demo) {
      const sequence: ProcessingStage[] = ["validating", "layout", "assembling", "assets", "quality_check", "ready"];
      let index = Math.max(0, sequence.indexOf(initialJob.stage));
      const timer = window.setInterval(() => {
        index += 1;
        const next = sequence[Math.min(index, sequence.length - 1)];
        const progress = next === "ready" ? 100 : Math.min(94, 20 + index * 14);
        setJob((current) => ({ ...current, stage: next, status: next === "ready" ? "ready" : "processing", progress }));
        if (next === "ready") window.clearInterval(timer);
      }, 1500);
      return () => window.clearInterval(timer);
    }

    const supabase = createClient();
    if (!supabase) return;
    const channel = supabase.channel(`job:${initialJob.id}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "processing_jobs", filter: `id=eq.${initialJob.id}` }, (payload) => setJob(payload.new as ProcessingJob)).subscribe();
    let lastDispatch = 0;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
      const { data } = await supabase.from("processing_jobs").select("*").eq("id", initialJob.id).single();
      if (data) {
        setJob(data as ProcessingJob);
        const now = Date.now();
        const idleSince = Date.parse(data.heartbeat_at ?? data.created_at ?? data.updated_at);
        const needsRecovery = (data.status === "queued" && now - idleSince >= 120_000)
          || (data.status === "processing" && now - idleSince >= 300_000);
        if (needsRecovery && now - lastDispatch >= 120_000) {
          lastDispatch = now;
          await fetch(`/api/documents/${data.document_id}/dispatch`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: data.id }),
          }).catch(() => undefined);
        }
      }
      } finally { refreshing = false; }
    };
    void refresh();
    const poll = window.setInterval(() => void refresh(), 5000);
    return () => { window.clearInterval(poll); void supabase.removeChannel(channel); };
  }, [demo, initialJob.id, initialJob.stage]);

  // A completed job changes the library and its active reader version. Clear
  // prefetched pages once per transition, including realtime and poll updates.
  useEffect(() => {
    if (lastStatus.current !== job.status) {
      lastStatus.current = job.status;
      if (job.status === "ready") toast.success("Your paper is ready to read", { id: `job-${job.id}` });
      if (job.status === "failed") toast.error("Paper processing failed", { id: `job-${job.id}` });
      if (!demo && (job.status === "ready" || job.status === "failed")) router.refresh();
    }
  }, [demo, job.id, job.status, router]);

  async function retry() {
    setRetrying(true);
    const supabase = createClient();
    if (!supabase) { setRetrying(false); return; }
    const { data, error } = await supabase.rpc("enqueue_document_processing", { p_document_id: initialJob.document_id });
    if (error || !data) {
      setJob((current) => ({ ...current, error_message: "Could not retry yet. Return to the library and try again." }));
      toast.error("Could not retry processing. Please try again.");
      setRetrying(false);
      return;
    }
    await fetch(`/api/documents/${initialJob.document_id}/dispatch`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: data.job_id }),
    }).catch(() => undefined);
    window.location.reload();
  }

  const ready = job.status === "ready" || job.stage === "ready";
  const failed = job.status === "failed" || job.stage === "failed";

  return <div className="processing-shell"><div className="processing-ambient ambient-one" /><div className="processing-ambient ambient-two" /><header className="processing-header"><Link href="/library" className="back-library">← Library</Link><Brand /></header><section className={`processing-card${ready ? " is-ready" : ""}`}><ParsingAnimation stage={job.stage} progress={job.progress} ready={ready} failed={failed} /><div aria-live="polite" aria-atomic="true"><div className="processing-status" key={ready ? "ready" : failed ? `failed:${job.error_message ?? ""}` : job.stage === "queued" ? "queued" : activeIndex}><span className="processing-kicker">{ready ? "Reading copy ready" : failed ? "Processing paused" : "Preparing your paper"}</span><h1>{ready ? "Your paper is ready to read." : failed ? "We couldn’t finish this paper." : job.stage === "queued" ? "Your paper is in line." : stages[Math.max(0, activeIndex)]?.title ?? "Preparing your paper"}</h1><p>{ready ? "Your reading copy is saved. Use Original in the reader to view figures, tables, and equations." : failed ? job.error_message || "You can safely retry without uploading the source again." : job.stage === "queued" ? "Processing will begin as soon as the worker is available. You can leave this page and come back." : stages[Math.max(0, activeIndex)]?.detail}</p></div></div><div className="processing-file"><FileText size={16} /><span>{filename}</span></div>{ready ? <Link className="button button-primary read-reveal" href={`/documents/${documentRef}/read`} prefetch={true}><BookOpen size={18} />Read paper</Link> : failed ? <button className="button button-secondary" type="button" onClick={retry} disabled={retrying}><RotateCcw size={17} />{retrying ? "Retrying…" : "Try again"}</button> : <ol className="parsing-steps" aria-label="Parsing stages">{["Inspect", "Extract", "Assemble"].map((name, index) => <li key={name} className={parsingStep > index ? "is-complete" : ""} aria-current={parsingStep === index ? "step" : undefined}><span>{parsingStep > index ? <Check size={12} /> : `0${index + 1}`}</span>{name}</li>)}</ol>}</section></div>;
}
