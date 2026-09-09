"use client";

import { Globe2, LoaderCircle, MoreHorizontal, RefreshCw, Share2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { DocumentShareDialog, type ShareState } from "./document-share-dialog";
import type { LibraryDocument } from "@/lib/types/document";

export function DocumentActions({ document, layout = "menu" }: { document: LibraryDocument; layout?: "menu" | "row" }) {
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareState, setShareState] = useState<ShareState>({ status: "preparing" });
  const [preparing, setPreparing] = useState(false);
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !menu.current || !menuTrigger.current) return;
    const element = menu.current;
    element.showPopover();
    const position = () => {
      if (!menuTrigger.current) return;
      const bounds = menuTrigger.current.getBoundingClientRect();
      const { width, height } = element.getBoundingClientRect();
      element.style.left = `${Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12))}px`;
      element.style.top = `${Math.max(12, bounds.bottom + height + 8 > window.innerHeight ? bounds.top - height - 8 : bounds.bottom + 8)}px`;
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open]);

  async function run(label: string, success: string, action: () => Promise<void>, tone: "success" | "change" = "success") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    const id = toast.loading(label);
    try { await action(); toast.success(success, { id, classNames: tone === "change" ? { success: "toast-action-red" } : undefined }); setOpen(false); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Something went wrong. Please try again.", { id }); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function share() {
    setOpen(false);
    setShareOpen(true);
    if (inFlight.current) return;
    if (document.status === "published" && document.public_slug) {
      setShareState({ status: "ready", url: `${window.location.origin}/p/${document.public_slug}` });
      return;
    }
    if (shareState.status === "ready") return;
    inFlight.current = true;
    setPreparing(true);
    setShareState({ status: "preparing" });
    try {
      const supabase = createClient();
      if (!supabase || !document.active_version_id) throw new Error("The paper must be ready before you can share it.");
      const { data, error } = await supabase.rpc("publish_document", { p_document_id: document.id, p_version_id: document.active_version_id });
      if (error || typeof data !== "string" || !data) throw new Error("Could not prepare the link. Please try again.");
      setShareState({ status: "ready", url: `${window.location.origin}/p/${data}` });
      router.refresh();
    } catch (error) {
      setShareState({ status: "error", message: error instanceof Error ? error.message : "Could not prepare the link. Please try again." });
    } finally { inFlight.current = false; setPreparing(false); }
  }
  async function stopSharing() {
    await run("Removing public access…", "Paper is private", async () => {
      const supabase = createClient();
      if (!supabase) throw new Error("Sign in to manage your papers.");
      const { error } = await supabase.rpc("unpublish_document", { p_document_id: document.id });
      if (error) throw new Error("Could not update the paper. Please try again.");
      setShareState({ status: "preparing" });
      router.refresh();
    }, "change");
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
    }, "change");
  }
  const actionBusy = busy || preparing;
  const canShare = !!document.active_version_id && ["ready", "published"].includes(document.status);
  const canReprocess = ["ready", "failed", "published"].includes(document.status);
  return <div className={`document-actions${layout === "row" ? " document-actions-row" : ""}`}>
    {layout === "row" && <>
      {canShare && <button ref={trigger} className="row-action" type="button" disabled={busy} aria-label={`Share ${document.title}`} title="Share" aria-haspopup="dialog" aria-expanded={shareOpen} onClick={share}><Share2 size={17} /></button>}
      <button className="row-action danger-action" type="button" disabled={actionBusy} aria-label={`Delete ${document.title}`} title="Delete" onClick={remove}><Trash2 size={17} /></button>
    </>}
    {(layout === "menu" || canReprocess) && <button ref={element => { menuTrigger.current = element; if (layout === "menu" || !canShare) trigger.current = element; }} className="card-menu" type="button" disabled={busy} onClick={() => { setShareOpen(false); setOpen(value => !value); }} aria-label={`More actions for ${document.title}`} aria-expanded={open || (layout === "menu" && shareOpen)}>{busy ? <LoaderCircle className="spin" size={17} /> : <MoreHorizontal size={19} />}</button>}
    {open && <div ref={menu} className="document-menu document-menu-popover" popover="auto" onToggle={event => { if (event.newState === "closed") setOpen(false); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); menuTrigger.current?.focus(); } }}>
      {layout === "menu" && canShare && <button disabled={actionBusy} type="button" aria-haspopup="dialog" onClick={share}><Share2 size={14} />Share</button>}
      {document.status === "published" && <button disabled={actionBusy} type="button" onClick={stopSharing}><Globe2 size={14} />Stop sharing</button>}
      {canReprocess && <button disabled={actionBusy} type="button" onClick={reprocess}><RefreshCw size={14} />Reprocess</button>}
      {layout === "menu" && <button disabled={actionBusy} className="danger-action" type="button" onClick={remove}><Trash2 size={14} />Delete</button>}
    </div>}
    <DocumentShareDialog open={shareOpen} anchor={trigger} state={shareState} onClose={() => setShareOpen(false)} onRetry={share} />
  </div>;
}
