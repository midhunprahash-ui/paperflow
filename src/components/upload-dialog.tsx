"use client";

import { FileText, LoaderCircle, Plus, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const acceptedTypes = ["application/pdf", ""];

type UploadContract = { document_id: number; document_ref: string; storage_path: string };

export function UploadDialog() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chooseFile(candidate?: File) {
    if (!candidate) return;
    setError(null);
    const extensionOk = candidate.name.toLowerCase().endsWith(".pdf");
    if (!extensionOk || !acceptedTypes.includes(candidate.type)) {
      setError("Choose a PDF research paper. Export Word documents as PDF first.");
      toast.error("Choose a PDF research paper");
      return;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      setError("This file is larger than the 25 MB prototype limit.");
      toast.error("This file exceeds the 25 MB limit");
      return;
    }
    setFile(candidate);
  }

  async function upload() {
    if (!file || busy) return;
    setBusy(true); setError(null);
    const notification = toast.loading("Adding your paper…");
    try {
      if (!isSupabaseConfigured) {
        toast.success("Paper added", { id: notification });
        router.push("/documents/doc_000000000002/processing?demo=1");
        return;
      }
      const supabase = createClient();
      if (!supabase) throw new Error("Sign in to add a paper.");
      const form = new FormData(); form.set("file", file);
      const validation = await fetch("/api/documents/validate", { method: "POST", body: form });
      if (!validation.ok) {
        const result = await validation.json();
        throw new Error(result.error || "Choose an unlocked PDF with at most 16 pages.");
      }
      const { data, error: createError } = await supabase.rpc("create_document_upload", {
        p_filename: file.name, p_media_type: "pdf", p_byte_size: file.size, p_checksum: null,
      });
      if (createError || !data) throw new Error(createError?.message ?? "Could not prepare the upload.");
      const contract = data as UploadContract;
      const { error: uploadError } = await supabase.storage.from("research-documents").upload(contract.storage_path, file, {
        contentType: "application/pdf", cacheControl: "3600", upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);
      const { data: job, error: jobError } = await supabase.rpc("enqueue_document_processing", { p_document_id: contract.document_id });
      if (jobError || !job) throw new Error("The file was added, but processing could not start. Retry from your library.");
      const response = await fetch(`/api/documents/${contract.document_id}/dispatch`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job.job_id }),
      }).catch(() => null);
      if (response?.ok) toast.success("Paper added", { id: notification, description: "Your reading copy is being prepared." });
      else toast.warning("Paper added; processing will retry shortly", { id: notification });
      router.push(`/documents/${contract.document_ref}/processing`); router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not add the paper. Please try again.";
      setError(message); toast.error(message, { id: notification });
    } finally { setBusy(false); }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  return (
    <>
      <button className="add-paper-button" type="button" onClick={() => setOpen(true)} aria-label="Add a research paper">
        <Plus size={18} strokeWidth={1.8} /><span>Add paper</span>
      </button>
      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
          <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title">
            <button className="modal-close" type="button" onClick={() => setOpen(false)} disabled={busy} aria-label="Close"><X size={19} /></button>
            <div className="upload-heading"><span className="upload-icon"><UploadCloud size={22} /></span><h2 id="upload-title">Add a research paper</h2><p>We’ll preserve the paper’s hierarchy and include source images wherever math or scanned formatting needs them.</p></div>
            <div
              className={`drop-zone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              {file ? (
                <div className="selected-file"><FileText size={28} /><div><strong>{file.name}</strong><span>{formatBytes(file.size)} · Ready to upload</span></div><button type="button" onClick={() => setFile(null)} disabled={busy}>Change</button></div>
              ) : (
                <><UploadCloud size={30} /><strong>Drop your paper here</strong><span>PDF, up to 25 MB and 16 pages</span><button className="button button-secondary button-small" type="button" onClick={() => inputRef.current?.click()}>Choose file</button></>
              )}
              <input ref={inputRef} hidden type="file" accept=".pdf,application/pdf" onChange={(event: ChangeEvent<HTMLInputElement>) => chooseFile(event.target.files?.[0])} />
            </div>
            {error && <p className="upload-error" role="alert">{error}</p>}
            <div className="upload-footer"><span>Your original stays private.</span><button className="button button-primary" type="button" onClick={upload} disabled={!file || busy}>{busy ? <><LoaderCircle className="spin" size={18} />Uploading…</> : "Upload and parse"}</button></div>
          </section>
        </div>
      )}
    </>
  );
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}
