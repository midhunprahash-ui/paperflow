"use client";

import { Copy, Globe2, LoaderCircle, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { LibraryDocument } from "@/lib/types/document";

export function DocumentActions({ document }: { document: LibraryDocument }) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function close(event: MouseEvent) { if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false); }
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  async function publish() {
    if (!document.active_version_id) return;
    setBusy(true);
    const supabase = createClient();
    if (!supabase) { setBusy(false); setOpen(false); return; }
    const { error } = await supabase.rpc("publish_document", { p_document_id: document.id, p_version_id: document.active_version_id });
    setBusy(false);
    if (!error) { setOpen(false); router.refresh(); }
  }

  async function unpublish() {
    setBusy(true);
    const supabase = createClient();
    if (!supabase) { setBusy(false); setOpen(false); return; }
    const { error } = await supabase.rpc("unpublish_document", { p_document_id: document.id });
    setBusy(false);
    if (!error) { setOpen(false); router.refresh(); }
  }

  async function reprocess() {
    setBusy(true);
    const supabase = createClient();
    if (!supabase) { setBusy(false); setOpen(false); return; }
    const { data, error } = await supabase.rpc("enqueue_document_processing", { p_document_id: document.id });
    if (!error && data) {
      const job = data as { job_id: number };
      await fetch(`/api/documents/${document.id}/dispatch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job.job_id }) });
      router.push(`/documents/${document.document_ref}/processing`);
      return;
    }
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm(`Delete “${document.title}” and its original file? This cannot be undone.`)) return;
    setBusy(true);
    const response = await fetch(`/api/documents/${document.id}`, { method: "DELETE" });
    setBusy(false);
    if (response.ok) { setOpen(false); router.refresh(); }
  }

  function copyLink() {
    if (!document.public_slug) return;
    void navigator.clipboard.writeText(`${window.location.origin}/p/${document.public_slug}`);
    setOpen(false);
  }

  return <div className="document-actions" ref={wrapperRef}><button className="card-menu" type="button" onClick={() => setOpen((value) => !value)} aria-label={`More actions for ${document.title}`} aria-expanded={open}>{busy ? <LoaderCircle className="spin" size={17} /> : <MoreHorizontal size={19} />}</button>{open && <div className="document-menu">{document.status === "ready" && document.active_version_id && <button type="button" onClick={publish}><Globe2 size={14} />Publish</button>}{document.status === "published" && <><button type="button" onClick={copyLink}><Copy size={14} />Copy public link</button><button type="button" onClick={unpublish}><Globe2 size={14} />Unpublish</button></>}{["ready", "failed", "published"].includes(document.status) && <button type="button" onClick={reprocess}><RefreshCw size={14} />Reprocess</button>}<button className="danger-action" type="button" onClick={remove}><Trash2 size={14} />Delete</button></div>}</div>;
}
