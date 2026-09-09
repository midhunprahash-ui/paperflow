"use client";

import { Check, Copy, Link2, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";

export type ShareState = { status: "preparing" } | { status: "ready"; url: string } | { status: "error"; message: string };

type Props = {
  open: boolean;
  anchor: RefObject<HTMLButtonElement | null>;
  state: ShareState;
  onClose: () => void;
  onRetry: () => void;
};

export function DocumentShareDialog({ open, anchor, state, onClose, onRetry }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const linkId = useId();
  const [copiedUrl, setCopiedUrl] = useState("");
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (!open) { element.hidePopover(); return; }
    element.showPopover();
    const position = () => {
      if (!panel.current || !anchor.current) return;
      const bounds = anchor.current.getBoundingClientRect();
      const { width, height } = panel.current.getBoundingClientRect();
      const below = bounds.bottom + 8;
      const top = below + height <= window.innerHeight - 16 ? below : bounds.top - height - 8;
      panel.current.style.left = `${Math.max(16, Math.min(bounds.right - width, window.innerWidth - width - 16))}px`;
      panel.current.style.top = `${Math.max(16, Math.min(top, window.innerHeight - height - 16))}px`;
    };

    position();
    closeButton.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(element);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, anchor]);

  function close() {
    panel.current?.hidePopover();
    anchor.current?.focus({ preventScroll: true });
    onClose();
  }

  async function copyLink() {
    if (state.status !== "ready" || copying) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(state.url);
      setCopiedUrl(state.url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link. Select it and copy it manually.");
    } finally { setCopying(false); }
  }

  return <div ref={panel} className="document-share-dialog" role="dialog" popover="auto" aria-labelledby={titleId}
    onToggle={event => { if (event.newState === "closed") onClose(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
    <div className="document-share-heading"><h2 id={titleId}><Link2 size={17} aria-hidden="true" />Share paper</h2><button ref={closeButton} className="icon-button" type="button" aria-label="Close sharing" onClick={close}><X size={17} /></button></div>
    <div className="document-share-status" role="status" aria-live="polite">
      {state.status === "preparing" ? <p className="document-share-preparing"><LoaderCircle className="spin" size={18} aria-hidden="true" />Preparing link…</p> : state.status === "ready" ? <p>Your link is ready. Anyone with this link can read the paper.</p> : <p className="document-share-error">{state.message}</p>}
    </div>
    {state.status === "ready" && <div className="document-share-link"><label className="sr-only" htmlFor={linkId}>Shareable link</label><input id={linkId} type="text" readOnly value={state.url} onFocus={event => event.currentTarget.select()} /><button type="button" className="button button-primary button-small" aria-disabled={copying} onClick={copyLink}>{copiedUrl === state.url ? <Check size={15} /> : <Copy size={15} />}{copying ? "Copying…" : copiedUrl === state.url ? "Copied" : "Copy link"}</button></div>}
    {state.status === "error" && <button className="button button-secondary button-small" type="button" onClick={onRetry}>Try again</button>}
  </div>;
}
