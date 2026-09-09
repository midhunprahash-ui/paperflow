"use client";

import { LogOut, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

type Props = { name: string; email?: string; initials: string; busy: boolean; error?: string | null; onSignOut: () => void };

export function ProfileMenu({ name, email, initials, busy, error, onSignOut }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const positionPanel = useCallback(() => {
    if (!trigger.current || !panel.current) return;
    const bounds = trigger.current.getBoundingClientRect();
    panel.current.style.left = `${bounds.left}px`;
    panel.current.style.bottom = `${window.innerHeight - bounds.top + 10}px`;
    panel.current.style.maxHeight = `${Math.max(0, bounds.top - 26)}px`;
  }, []);

  useEffect(() => {
    if (!open || !trigger.current) return;
    const observer = new ResizeObserver(positionPanel);
    observer.observe(trigger.current);
    window.addEventListener("resize", positionPanel);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", positionPanel);
    };
  }, [open, positionPanel]);

  return <>
    <button ref={trigger} type="button" className="profile-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} aria-label={`Open profile menu for ${name}`} popoverTarget={id} onClick={positionPanel}>
      <span className="avatar" aria-hidden="true">{initials}</span><span className="profile-compact-name">{name}</span>
    </button>
    <div ref={panel} id={id} className="profile-dialog" role="dialog" popover="auto" aria-label="Your profile"
      onToggle={event => setOpen(event.newState === "open")}>
      <div className="profile-dialog-heading"><span>Your account</span><button type="button" className="icon-button" aria-label="Close profile" onClick={() => { panel.current?.hidePopover(); trigger.current?.focus(); }}><X size={18} /></button></div>
      <div className="profile-dialog-identity"><span className="avatar" aria-hidden="true">{initials}</span><h2>{name}</h2>{email && <p>{email}</p>}</div>
      <button className="profile-signout" type="button" disabled={busy} onClick={onSignOut}><LogOut size={17} />{busy ? "Signing out…" : "Sign out"}</button>
      {error && <p className="profile-error" role="alert">{error}</p>}
    </div>
  </>;
}
