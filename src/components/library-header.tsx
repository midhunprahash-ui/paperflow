"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Brand } from "./brand";
import { ProfileMenu } from "./profile-menu";
import { createClient } from "@/lib/supabase/client";

export function LibraryHeader({ email, fullName }: { email?: string; fullName?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const name = fullName?.trim() || email || "Your account";
  const words = name.split(/\s+/);
  const initials = (words[0][0] + (words.length > 1 ? words.at(-1)![0] : "")).toUpperCase();

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setSignOutError(null);
    try {
      const result = await createClient()?.auth.signOut();
      if (result?.error) throw result.error;
      toast.success("Signed out");
      router.replace("/"); router.refresh();
    } catch {
      const message = "Could not sign out. Please try again.";
      setSignOutError(message);
      toast.error(message);
      setBusy(false);
    }
  }

  return <><header className="library-corner-header"><Brand href="/library" /></header><ProfileMenu name={name} email={email} initials={initials} busy={busy} error={signOutError} onSignOut={signOut} /></>;
}
