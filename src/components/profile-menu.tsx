"use client";

import { LogOut, X } from "lucide-react";
import { useId, useRef, useState } from "react";

type Props = { name: string; email?: string; initials: string; busy: boolean; error?: string | null; onSignOut: () => void };

export function ProfileMenu({ name, email, initials, busy, error, onSignOut }: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="profile-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} aria-label={`Open profile menu for ${name}`} onClick={() => { dialog.current?.showModal(); setOpen(true); }}>
      <span className="avatar" aria-hidden="true">{initials}</span><span className="profile-compact-name">{name}</span>
    </button>
    <dialog ref={dialog} id={id} className="profile-dialog" aria-label="Your profile" onClose={() => setOpen(false)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
    }}>
      <div className="profile-dialog-heading"><span>Your account</span><button type="button" className="icon-button" aria-label="Close profile" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      <div className="profile-dialog-identity"><span className="avatar" aria-hidden="true">{initials}</span><h2>{name}</h2>{email && <p>{email}</p>}</div>
      <button className="profile-signout" type="button" disabled={busy} onClick={onSignOut}><LogOut size={17} />{busy ? "Signing out…" : "Sign out"}</button>
      {error && <p className="profile-error" role="alert">{error}</p>}
    </dialog>
  </>;
}
