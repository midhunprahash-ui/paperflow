import { createHmac } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const id = Number(documentId);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Invalid document" }, { status: 400 });

  const supabase = await createClient();
  if (!supabase) return Response.json({ accepted: true, demo: true }, { status: 202 });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { jobId?: number };
  if (!Number.isSafeInteger(body.jobId)) return Response.json({ error: "Invalid job" }, { status: 400 });

  const { data: document } = await supabase.from("documents").select("id,owner_id").eq("id", id).eq("owner_id", userData.user.id).single();
  if (!document) return Response.json({ error: "Not found" }, { status: 404 });

  const endpoint = process.env.MODAL_DISPATCH_URL;
  const secret = process.env.WORKER_CALLBACK_SECRET;
  if (!endpoint || !secret) return Response.json({ error: "Parser is not configured" }, { status: 503 });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = JSON.stringify({ documentId: id, jobId: body.jobId });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-rpaper-timestamp": timestamp,
      "x-rpaper-signature": signature,
      ...(process.env.MODAL_PROXY_AUTH_ID ? { "Modal-Key": process.env.MODAL_PROXY_AUTH_ID } : {}),
      ...(process.env.MODAL_PROXY_AUTH_SECRET ? { "Modal-Secret": process.env.MODAL_PROXY_AUTH_SECRET } : {}),
    },
    body: payload,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return Response.json({ error: "Parser rejected the job" }, { status: 502 });
  return Response.json({ accepted: true }, { status: 202 });
}
