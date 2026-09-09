"use client";

import dynamic from "next/dynamic";
import { MessageSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./feedback-widget.css";

const FeedbackForm = dynamic(() => import("./feedback-form"), { loading: () => <p className="feedback-loading" role="status">Opening feedback…</p> });
const noticeKey = "paperflow-feedback-notice";

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hint, setHint] = useState(false);
  const widget = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const interacted = useRef(false);
  const suppressFocus = useRef(false);

  useEffect(() => {
    let count = 0;
    try { const saved = sessionStorage.getItem(noticeKey); if (saved === "used") return; count = Number(saved) || 0; } catch {}
    let hide: ReturnType<typeof setTimeout>;
    function indicate() {
      if (interacted.current || document.hidden || count >= 3) return;
      count += 1;
      try { sessionStorage.setItem(noticeKey, String(count)); } catch {}
      setHint(true);
      hide = setTimeout(() => setHint(false), 7000);
    }
    const first = setTimeout(indicate, 60000);
    const repeat = setInterval(indicate, 300000);
    return () => { clearTimeout(first); clearTimeout(hide); clearInterval(repeat); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (widget.current && !event.composedPath().includes(widget.current)) {
        // Keep the draft mounted and let the clicked control receive focus.
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    return () => document.removeEventListener("pointerdown", dismissOutside, true);
  }, [open]);

  function reveal() {
    interacted.current = true;
    try { sessionStorage.setItem(noticeKey, "used"); } catch {}
    setHint(false); setMounted(true); setOpen(true);
  }
  function close() {
    setOpen(false);
    suppressFocus.current = true;
    trigger.current?.focus();
    suppressFocus.current = false;
  }
  return <aside ref={widget} className="feedback-widget" aria-label="Feedback" onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); close(); } }}>
    {mounted && <section id="feedback-panel" className="feedback-panel" hidden={!open} aria-label="Share feedback">
      <div className="feedback-heading"><div><strong>A little feedback?</strong><p>Help make paperflow better.</p></div><button type="button" className="icon-button" aria-label="Close feedback" onClick={close}><X size={17} /></button></div>
      <FeedbackForm onSent={close} />
    </section>}
    <button ref={trigger} type="button" className={`feedback-trigger${hint ? " feedback-notice" : ""}`} aria-expanded={open} aria-controls="feedback-panel"
      onPointerEnter={event => { if (event.pointerType === "mouse") reveal(); }}
      onFocus={() => { if (!suppressFocus.current) reveal(); }} onClick={reveal}>
      <MessageSquare size={15} aria-hidden="true" /><span>Feedback</span>
    </button>
    {hint && !open && <span className="feedback-hint">Have a thought? Share it here.</span>}
  </aside>;
}
