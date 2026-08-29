"use client";

import { LogOut, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { createClient } from "@/lib/supabase/client";

export function LibraryHeader({ email, query = "" }: { email?: string; query?: string }) {
  const router = useRouter();
  async function signOut() {
    await createClient()?.auth.signOut();
    router.push("/");
    router.refresh();
  }
  return <header className="library-header"><Brand /><form className="library-search" action="/library"><Search size={16} /><input name="q" defaultValue={query} aria-label="Search your library" placeholder="Search papers" /></form><div className="library-account"><ThemeToggle /><span className="avatar" title={email}>{email?.slice(0, 1).toUpperCase() || "R"}</span><button className="icon-button" type="button" onClick={signOut} aria-label="Sign out"><LogOut size={17} /></button></div></header>;
}
