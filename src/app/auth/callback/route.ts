import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") || "/library";
  // Keep sessions on the host where sign-in began. Azure exposes an internal
  // request URL, so only accept forwarded hosts in our configured origin list.
  // SITE_URL is read at runtime; NEXT_PUBLIC_SITE_URL is frozen during build.
  const origins = [process.env.SITE_URL, process.env.NEXT_PUBLIC_SITE_URL,
    ...(process.env.AUTH_REDIRECT_ORIGINS ?? "").split(",")]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => new URL(value.trim()).origin);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const origin = process.env.NODE_ENV === "production" && origins.length
    ? origins.find(value => new URL(value).host === host) ?? origins[0]
    : request.nextUrl.origin;
  const safeNext = next.startsWith("/") && !next.startsWith("//") && !/[\\\u0000-\u0020]/.test(next) ? next : "/library";
  const destination = new URL(safeNext, origin);
  const failure = new URL("/auth/sign-in", origin);
  failure.searchParams.set("error", "oauth_callback_failed");
  failure.searchParams.set("next", destination.pathname + destination.search);

  let target = failure;
  if (code) {
    const supabase = await createClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) target = destination;
    }
  }
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
