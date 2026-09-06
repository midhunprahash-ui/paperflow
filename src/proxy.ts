import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/library/:path*", "/documents/:path*", "/auth/sign-in", "/auth/sign-up", "/api/:path*"],
};
