"use client";

import { Copy, Globe2, LoaderCircle, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { LibraryDocument } from "@/lib/types/document";

export function DocumentActions({ document }: { document: LibraryDocument }) {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) { if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false); }
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  async function run(label: string, success: string, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    const id = toast.loading(label);
    try { await action(); toast.success(success, { id }); setOpen(false); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Something went wrong. Please try again.", { id }); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function publish(unpublish = false) {
    await run(unpublish ? "Removing public access…" : "Publishing paper…", unpublish ? "Paper is private" : "Paper published", async () => {
      const supabase = createClient();
      if (!supabase) throw new Error("Sign in to manage your papers.");
      const { error } = unpublish
        ? await supabase.rpc("unpublish_document", { p_document_id: document.id })
        : await supabase.rpc("publish_document", { p_document_id: document.id, p_version_id: document.active_version_id });
      if (error) throw new Error("Could not update the paper. Please try again.");
      router.refresh();
    });
  }
  async function reprocess() {
    await run("Queuing paper…", "Paper queued for processing", async () => {
      const supabase = createClient();
      if (!supabase) throw new Error("Sign in to manage your papers.");
      const { data, error } = await supabase.rpc("enqueue_document_processing", { p_document_id: document.id });
      if (error || !data) throw new Error("Could not queue the paper. Please try again.");
      const response = await fetch(`/api/documents/${document.id}/dispatch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: data.job_id }) }).catch(() => null);
      router.push(`/documents/${document.document_ref}/processing`); router.refresh();
      if (!response?.ok) throw new Error("Paper is queued; processing will retry shortly.");
    });
  }
  async function remove() {
    await run("Deleting paper…", "Paper deleted from your library", async () => {
      const response = await fetch(`/api/documents/${document.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete the paper. Please try again.");
      router.refresh();
    });
  }
  async function copyLink() {
    await run("Copying link…", "Public link copied", async () => {
      if (!document.public_slug) throw new Error("Publish this paper first.");
      await navigator.clipboard.writeText(`${window.location.origin}/p/${document.public_slug}`);
    });
  }
  return <div className="document-actions" ref={wrapperRef}><button className="card-menu" type="button" disabled={busy} onClick={() => setOpen(value => !value)} aria-label={`More actions for ${document.title}`} aria-expanded={open}>{busy ? <LoaderCircle className="spin" size={17} /> : <MoreHorizontal size={19} />}</button>{open && <div className="document-menu">{document.status === "ready" && document.active_version_id && <button disabled={busy} type="button" onClick={() => publish()}><Globe2 size={14} />Publish</button>}{document.status === "published" && <><button disabled={busy} type="button" onClick={copyLink}><Copy size={14} />Copy public link</button><button disabled={busy} type="button" onClick={() => publish(true)}><Globe2 size={14} />Unpublish</button></>}{["ready", "failed", "published"].includes(document.status) && <button disabled={busy} type="button" onClick={reprocess}><RefreshCw size={14} />Reprocess</button>}<button disabled={busy} className="danger-action" type="button" onClick={remove}><Trash2 size={14} />Delete</button></div>}</div>;
}
