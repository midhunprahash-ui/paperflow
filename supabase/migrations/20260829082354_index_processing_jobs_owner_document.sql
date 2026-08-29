create index processing_jobs_owner_document_idx
on public.processing_jobs (owner_id, document_id);
