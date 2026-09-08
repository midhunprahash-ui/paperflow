import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const input = z.object({
  id: z.uuid(),
  name: z.string().trim().max(160).optional(),
  email: z.string().trim().max(254).optional(),
  feedback: z.string().trim().min(5).max(4000),
});
const identity = z.object({ name: z.string().trim().min(1).max(160), email: z.email().max(254) });

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Please send a valid feedback form." }, { status: 415 });
  }
  const text = await request.text();
  if (text.length > 12000) return Response.json({ error: "Feedback is too long." }, { status: 413 });
  let body;
  try { body = input.safeParse(JSON.parse(text)); } catch { return Response.json({ error: "Invalid feedback." }, { status: 400 }); }
  if (!body.success) return Response.json({ error: "Please enter feedback between 5 and 4,000 characters." }, { status: 400 });
  const client = await createClient();
  const admin = createAdminClient();
  if (!client || !admin) return Response.json({ error: "Feedback is temporarily unavailable. Please try again." }, { status: 503 });
  const { data: { user }, error: authError } = await client.auth.getUser();
  // Missing sessions are expected for visitors; an unavailable auth server is not.
  if (authError && authError.name !== "AuthSessionMissingError") {
    return Response.json({ error: "Please refresh the page and try again." }, { status: 503 });
  }
  const metadata = user?.user_metadata;
  const fullName = metadata && [metadata.first_name, metadata.last_name].filter(v => typeof v === "string").join(" ").trim();
  const sender = identity.safeParse(user ? {
    name: fullName || metadata?.full_name || metadata?.name || user.email?.split("@")[0],
    email: user.email,
  } : { name: body.data.name, email: body.data.email });
  if (!sender.success) return Response.json({ error: "Please enter your name and a valid email address." }, { status: 400 });
  const { data, error } = await admin.rpc("submit_feedback", {
    p_id: body.data.id, p_name: sender.data.name, p_email: sender.data.email.toLowerCase(),
    p_feedback: body.data.feedback, p_user_id: user?.id ?? null,
  });
  if (error) return Response.json({ error: "Your feedback wasn’t saved. Please try again." }, { status: 503 });
  if (data === "rate_limited") return Response.json({ error: "Please wait 30 seconds before sending more feedback." }, { status: 429, headers: { "Retry-After": "30" } });
  if (data !== "accepted") return Response.json({ error: "Please close and reopen the form, then try again." }, { status: 409 });
  return Response.json({ saved: true }, { status: 201 });
}
