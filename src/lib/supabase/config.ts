export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const isSupabaseConfigured =
  (supabaseUrl.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(supabaseUrl)) &&
  !supabaseUrl.includes("your-project") &&
  supabasePublishableKey.length > 20 &&
  !supabasePublishableKey.includes("...");
