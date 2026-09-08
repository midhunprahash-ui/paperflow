"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Clear private route snapshots when the account changes, including other tabs. */
export function SessionCacheBoundary() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let identity: string | null | undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextIdentity = session?.user.id ?? null;
      if (event === "SIGNED_OUT" || (identity !== undefined && identity !== nextIdentity)) {
        router.refresh();
      }
      identity = nextIdentity;
    });
    return () => subscription.unsubscribe();
  }, [router]);
  return null;
}
