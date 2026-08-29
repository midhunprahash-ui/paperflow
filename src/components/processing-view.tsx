"use client";

import { BookOpen, Check, Circle, FileText, LoaderCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProcessingJob, ProcessingStage } from "@/lib/types/document";

const stages: { key: ProcessingStage; title: string; detail: string }[] = [
  { key: "validating", title: "Inspecting your document", detail: "Checking the file and preparing a safe copy" },
  { key: "layout", title: "Understanding the layout", detail: "Finding sections, columns, captions, and reading order" },
  { key: "ocr", title: "Reading every page", detail: "Extracting text and applying OCR where needed" },
  { key: "tables_formulas", title: "Preserving technical content", detail: "Reconstructing tables, equations, and references" },
  { key: "assets", title: "Collecting figures", detail: "Saving diagrams, charts, and source fallbacks" },
  { key: "assembling", title: "Building your reader", detail: "Creating the responsive ebook structure" },
  { key: "quality_check", title: "Checking completeness", detail: "Verifying that nothing was left behind" },
];

export function ProcessingView({ initialJob, documentRef, filename, demo = false }: { initialJob: ProcessingJob; documentRef: string; filename: string; demo?: boolean }) {
  const [job, setJob] = useState(initialJob);
  const activeIndex = stages.findIndex((stage) => stage.key === job.stage);

  useEffect(() => {
    if (demo) {
      const sequence: ProcessingStage[] = ["layout", "ocr", "tables_formulas", "assets", "assembling", "quality_check", "ready"];
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
    const poll = window.setInterval(async () => {
      const { data } = await supabase.from("processing_jobs").select("*").eq("id", initialJob.id).single();
      if (data) setJob(data as ProcessingJob);
    }, 15000);
    return () => { window.clearInterval(poll); void supabase.removeChannel(channel); };
  }, [demo, initialJob.id, initialJob.stage]);

  const ready = job.status === "ready" || job.stage === "ready";
  const failed = job.status === "failed" || job.stage === "failed";

  return <div className="processing-shell"><div className="processing-ambient ambient-one" /><div className="processing-ambient ambient-two" /><header className="processing-header"><Link href="/library" className="back-library">← Library</Link><span>Rpaper</span><span className="privacy-note">Private workspace</span></header><section className={`processing-card${ready ? " is-ready" : ""}`}><div className="document-orbit"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="document-glyph">{ready ? <Check size={35} /> : <FileText size={35} />}</span></div><span className="processing-kicker">{ready ? "Reading copy ready" : failed ? "Processing paused" : "Preparing your paper"}</span><h1>{ready ? "Your paper is ready to read." : failed ? "We couldn’t finish this paper." : stages[Math.max(0, activeIndex)]?.title ?? "Waiting for the parser"}</h1><p>{ready ? "Every section has been assembled into a clean, responsive reading experience." : failed ? job.error_message || "You can safely retry without uploading the source again." : stages[Math.max(0, activeIndex)]?.detail}</p><div className="processing-file"><FileText size={16} /><span>{filename}</span><strong>{job.progress}%</strong></div><div className="progress-track" aria-label={`${job.progress}% processed`}><span style={{ width: `${job.progress}%` }} /></div>{ready ? <Link className="button button-primary read-reveal" href={`/documents/${documentRef}/read`}><BookOpen size={18} />Read paper</Link> : failed ? <button className="button button-secondary" type="button"><RotateCcw size={17} />Try again</button> : <div className="stage-list">{stages.map((stage, index) => { const complete = activeIndex > index; const active = activeIndex === index; return <div key={stage.key} className={`stage-row${complete ? " complete" : ""}${active ? " active" : ""}`}>{complete ? <Check size={15} /> : active ? <LoaderCircle className="spin" size={15} /> : <Circle size={11} />}<span>{stage.title}</span></div>; })}</div>}</section></div>;
}
