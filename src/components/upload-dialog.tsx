"use client";

import { FileText, LoaderCircle, Plus, UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const acceptedTypes = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

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
    const extensionOk = candidate.name.toLowerCase().endsWith(".pdf") || candidate.name.toLowerCase().endsWith(".docx");
    if (!extensionOk || !acceptedTypes.includes(candidate.type)) {
      setError("Choose a PDF or DOCX research paper.");
      return;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      setError("This file is larger than the 25 MB prototype limit.");
      return;
    }
    setFile(candidate);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);

    if (!isSupabaseConfigured) {
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      router.push("/documents/doc_000000000002/processing?demo=1");
      return;
    }

    const supabase = createClient();
    if (!supabase) return;
    const mediaType = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
    const { data, error: createError } = await supabase.rpc("create_document_upload", {
      p_filename: file.name,
      p_media_type: mediaType,
      p_byte_size: file.size,
      p_checksum: null,
    });
    if (createError || !data) {
      setError(createError?.message ?? "Could not prepare the upload.");
      setBusy(false);
      return;
    }

    const contract = data as UploadContract;
    const { error: uploadError } = await supabase.storage.from("research-documents").upload(contract.storage_path, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return;
    }

    const { data: jobData, error: jobError } = await supabase.rpc("enqueue_document_processing", {
      p_document_id: contract.document_id,
    });
    if (jobError || !jobData) {
      setError(jobError?.message ?? "The file uploaded, but processing could not start.");
      setBusy(false);
      return;
    }

    const job = jobData as { job_id: number };
    const response = await fetch(`/api/documents/${contract.document_id}/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: job.job_id }),
    });
    if (!response.ok) {
      setError("The document is queued, but the parser is temporarily unavailable.");
      setBusy(false);
      return;
    }
    router.push(`/documents/${contract.document_ref}/processing`);
    router.refresh();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  return (
    <>
      <button className="add-paper-button" type="button" onClick={() => setOpen(true)} aria-label="Add a research paper">
        <Plus size={25} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
          <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title">
            <button className="modal-close" type="button" onClick={() => setOpen(false)} disabled={busy} aria-label="Close"><X size={19} /></button>
            <div className="upload-heading"><span className="upload-icon"><UploadCloud size={22} /></span><h2 id="upload-title">Add a research paper</h2><p>We’ll preserve the full document and prepare a calmer reading version.</p></div>
            <div
              className={`drop-zone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              {file ? (
                <div className="selected-file"><FileText size={28} /><div><strong>{file.name}</strong><span>{formatBytes(file.size)} · Ready to upload</span></div><button type="button" onClick={() => setFile(null)} disabled={busy}>Change</button></div>
              ) : (
                <><UploadCloud size={30} /><strong>Drop your paper here</strong><span>PDF or DOCX, up to 25 MB and 100 pages</span><button className="button button-secondary button-small" type="button" onClick={() => inputRef.current?.click()}>Choose file</button></>
              )}
              <input ref={inputRef} hidden type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event: ChangeEvent<HTMLInputElement>) => chooseFile(event.target.files?.[0])} />
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
