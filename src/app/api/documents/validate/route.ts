import { createClient } from "@/lib/supabase/server";
import { DoclingError, validatePdf } from "@/lib/docling-runtime";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const length = Number(request.headers.get("content-length"));
  if (length > 26 * 1024 * 1024) return Response.json({ error: "Choose a PDF up to 25 MB." }, { status: 413 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a PDF." }, { status: 400 });
    if (file.size > 25 * 1024 * 1024) return Response.json({ error: "Choose a PDF up to 25 MB." }, { status: 413 });
    return Response.json(await validatePdf(Buffer.from(await file.arrayBuffer())));
  } catch (error) {
    return Response.json({ error: error instanceof DoclingError ? error.message : "This PDF could not be checked." }, { status: 400 });
  }
}
