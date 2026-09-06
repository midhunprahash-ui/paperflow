import "server-only";
import { cache } from "react";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from "./config";

export const createClient = cache(async function createClient() {
  if (!isSupabaseConfigured) return null;
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. proxy.ts refreshes them.
        }
      },
    },
  });
});

export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!isSupabaseConfigured || !secret) return null;
  return createSupabaseClient(supabaseUrl, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
