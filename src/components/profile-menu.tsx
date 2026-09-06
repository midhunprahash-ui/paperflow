"use client";

import { ChevronUp, LogOut, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

type Props = { name: string; email?: string; initials: string; busy: boolean; error?: string | null; onSignOut: () => void };

export function ProfileMenu({ name, email, initials, busy, error, onSignOut }: Props) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = () => { if (panel.current?.matches(":popover-open")) panel.current.hidePopover(); };
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, []);

  return <footer className="sidebar-account">
    <button type="button" className="profile-trigger" popoverTarget={id} aria-haspopup="dialog" aria-expanded={open} aria-label={`Open profile menu for ${name}`} title={name} onClick={event => {
      if (!panel.current) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - 24);
      panel.current.style.width = `${width}px`;
      panel.current.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`;
      panel.current.style.bottom = `${Math.min(window.innerHeight - 100, window.innerHeight - bounds.top + 10)}px`;
      panel.current.style.maxHeight = `${Math.max(80, bounds.top - 24)}px`;
    }}>
      <span className="avatar" aria-hidden="true">{initials}</span>
      <span className="sidebar-account-label"><strong>{name}</strong><span>Your account</span></span>
      <ChevronUp className="profile-chevron" size={15} />
    </button>
    <div ref={panel} id={id} className="profile-menu" popover="auto" role="dialog" aria-label="Your profile" onToggle={event => setOpen(event.newState === "open")}>
      <div className="profile-menu-heading"><span>Account</span><button className="icon-button" type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="Close profile menu"><X size={16} /></button></div>
      <div className="profile-menu-identity"><span className="avatar" aria-hidden="true">{initials}</span><div><strong>{name}</strong>{email && <p>{email}</p>}</div></div>
      <button className="profile-signout" type="button" disabled={busy} onClick={onSignOut}><LogOut size={17} /><span>{busy ? "Signing out…" : "Sign out"}</span></button>
      {error && <p className="profile-error" role="alert">{error}</p>}
    </div>
  </footer>;
}
