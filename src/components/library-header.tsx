"use client";

import { Library, Menu, PanelLeft, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./brand";
import { ProfileMenu } from "./profile-menu";
import { createClient } from "@/lib/supabase/client";

export function LibraryHeader({ email, fullName }: { email?: string; fullName?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const name = fullName?.trim() || email || "Your account";
  const words = name.split(/\s+/);
  const initials = (words[0][0] + (words.length > 1 ? words.at(-1)![0] : "")).toUpperCase();

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 641px)");
    const closeOnDesktop = () => { if (desktop.matches) drawer.current?.close(); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setSignOutError(null);
    try {
      const result = await createClient()?.auth.signOut();
      if (result?.error) throw result.error;
      router.replace("/"); router.refresh();
    } catch {
      setSignOutError("Could not sign out. Please try again.");
      setBusy(false);
    }
  }

  const navigation = <nav aria-label="Workspace">
    <Link href="/library" className="sidebar-link is-active" aria-current="page" aria-label="My library" title="My library" onClick={() => drawer.current?.close()}><Library size={18} /><span>My library</span></Link>
  </nav>;
  const account = <ProfileMenu name={name} email={email} initials={initials} busy={busy} error={signOutError} onSignOut={signOut} />;

  return <>
    <aside className="workspace-sidebar" data-collapsed={collapsed} aria-label="Library sidebar">
      <div className="sidebar-heading"><Brand href="/library" onClick={() => drawer.current?.close()} /><button type="button" className="icon-button sidebar-toggle" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}><PanelLeft size={18} /></button></div>
      <div className="sidebar-section-label">Workspace</div>{navigation}{account}
    </aside>
    <header className="workspace-mobilebar"><Brand href="/library" onClick={() => drawer.current?.close()} /><button className="icon-button" type="button" aria-label="Open sidebar" aria-haspopup="dialog" aria-expanded={mobileOpen} onClick={() => { drawer.current?.showModal(); setMobileOpen(true); }}><Menu size={20} /></button></header>
    <dialog ref={drawer} className="workspace-mobile-drawer" aria-label="Library menu" onClose={event => setMobileOpen(event.currentTarget.open)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) drawer.current?.close();
    }}>
      <div className="sidebar-heading"><Brand href="/library" onClick={() => drawer.current?.close()} /><button className="icon-button" type="button" aria-label="Close sidebar" onClick={() => drawer.current?.close()}><X size={19} /></button></div>
      <div className="sidebar-section-label">Workspace</div>{navigation}{account}
    </dialog>
  </>;
}
