-- Server-only parser API. Authenticated browsers cannot claim or complete jobs.
create or replace function private.claim_docling_job(
  p_document_id bigint, p_job_id bigint, p_owner_id uuid, p_run_id text
) returns text language plpgsql security definer set search_path = '' as $$
declare v_doc public.documents; v_job public.processing_jobs;
begin
  select * into v_doc from public.documents
  where id = p_document_id and owner_id = p_owner_id and deleted_at is null for update;
  if not found then raise exception 'Document not found'; end if;
  select * into v_job from public.processing_jobs
  where id = p_job_id and document_id = p_document_id and owner_id = p_owner_id for update;
  if not found then raise exception 'Job not found'; end if;
  if v_doc.source_type <> 'pdf' then raise exception 'Upload a PDF for this parser'; end if;
  if v_job.status = 'ready' then return 'ready'; end if;
  if v_job.status = 'processing' and v_job.heartbeat_at > now() - interval '5 minutes' then
    return 'processing';
  end if;
  if v_job.status not in ('queued', 'processing') then raise exception 'Create a new processing attempt'; end if;
  if exists (select 1 from public.processing_jobs where document_id = p_document_id and id > p_job_id) then
    raise exception 'A newer processing attempt exists';
  end if;
  if nullif(p_run_id, '') is null then raise exception 'Missing run ID'; end if;
  update public.processing_jobs set status = 'processing', stage = 'validating', progress = 10,
    worker_job_id = p_run_id, started_at = now(), heartbeat_at = now(),
    error_code = null, error_message = null where id = p_job_id;
  update public.documents set status = case when published_version_id is null then 'processing' else 'published' end
    where id = p_document_id;
  return 'claimed';
end $$;

create or replace function private.finish_docling_job(
  p_document_id bigint, p_job_id bigint, p_owner_id uuid, p_run_id text,
  p_manifest_path text, p_page_count integer, p_block_count integer, p_quality jsonb, p_title text, p_assets jsonb
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_doc public.documents; v_job public.processing_jobs; v_prefix text; v_version bigint; v_number integer; v_asset jsonb; v_sequence integer := 0;
begin
  select * into v_doc from public.documents
    where id = p_document_id and owner_id = p_owner_id and deleted_at is null for update;
  if not found then raise exception 'Document not found'; end if;
  select * into v_job from public.processing_jobs
    where id = p_job_id and document_id = p_document_id and owner_id = p_owner_id
      and status = 'processing' and worker_job_id = p_run_id for update;
  if not found then raise exception 'Processing attempt is no longer active'; end if;
  v_prefix := p_owner_id::text || '/documents/' || v_doc.document_ref || '/runs/' || p_run_id || '/';
  if p_manifest_path <> v_prefix || 'manifest.json' then raise exception 'Invalid manifest path'; end if;
  if p_page_count is null or p_page_count not between 1 and 16 or p_block_count is null or p_block_count < 1 then
    raise exception 'Invalid parser output';
  end if;
  if jsonb_typeof(p_assets) is distinct from 'array' or jsonb_array_length(p_assets) > 4096 then
    raise exception 'Invalid asset inventory';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_number
    from public.document_versions where document_id = p_document_id;
  insert into public.document_versions(document_id, owner_id, version_number, manifest_path,
    parser_version, schema_version, page_count, block_count, quality_summary)
    values(p_document_id, p_owner_id, v_number, p_manifest_path, 'docling-local-v2', 2,
      p_page_count, p_block_count, coalesce(p_quality, '{}'::jsonb)) returning id into v_version;
  for v_asset in select value from jsonb_array_elements(p_assets) loop
    if v_asset->>'path' is null or left(v_asset->>'path', length(v_prefix)) <> v_prefix
       or v_asset->>'path' like '%/../%' or v_asset->>'mediaType' is distinct from 'image/png'
       or coalesce(v_asset->>'sha256','') !~ '^[a-f0-9]{64}$' then
      raise exception 'Invalid asset path or metadata';
    end if;
    v_sequence := v_sequence + 1;
    insert into public.document_assets(version_id,owner_id,kind,sequence_number,storage_path,media_type,checksum)
      values(v_version,p_owner_id,'fallback',v_sequence,v_asset->>'path','image/png',v_asset->>'sha256');
  end loop;
  update public.documents set active_version_id = v_version, page_count = p_page_count,
    title = left(coalesce(nullif(p_title,''),title),300),
    status = case when published_version_id is null then 'ready' else 'published' end
    where id = p_document_id;
  update public.processing_jobs set status = 'ready', stage = 'ready', progress = 100,
    finished_at = now(), heartbeat_at = now() where id = p_job_id;
  return v_version;
end $$;

create or replace function private.fail_docling_job(
  p_document_id bigint, p_job_id bigint, p_owner_id uuid, p_run_id text, p_message text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.documents where id = p_document_id and owner_id = p_owner_id
    and deleted_at is null for update;
  if not found then return; end if;
  update public.processing_jobs set status = 'failed', stage = 'failed',
    error_code = 'docling_parser_error', error_message = left(p_message, 500),
    finished_at = now(), heartbeat_at = now()
    where id = p_job_id and document_id = p_document_id and owner_id = p_owner_id
      and worker_job_id = p_run_id and status = 'processing';
  if found then
    update public.documents set status = case when published_version_id is not null then 'published'
      when active_version_id is not null then 'ready' else 'failed' end where id = p_document_id;
  end if;
end $$;

create or replace function public.claim_docling_job(p_document_id bigint, p_job_id bigint, p_owner_id uuid, p_run_id text)
returns text language sql security invoker set search_path = '' as $$
  select private.claim_docling_job(p_document_id, p_job_id, p_owner_id, p_run_id);
$$;
create or replace function public.finish_docling_job(p_document_id bigint, p_job_id bigint, p_owner_id uuid,
  p_run_id text, p_manifest_path text, p_page_count integer, p_block_count integer, p_quality jsonb, p_title text, p_assets jsonb)
returns bigint language sql security invoker set search_path = '' as $$
  select private.finish_docling_job(p_document_id, p_job_id, p_owner_id, p_run_id,
    p_manifest_path, p_page_count, p_block_count, p_quality, p_title, p_assets);
$$;
create or replace function public.fail_docling_job(p_document_id bigint, p_job_id bigint, p_owner_id uuid,
  p_run_id text, p_message text)
returns void language sql security invoker set search_path = '' as $$
  select private.fail_docling_job(p_document_id, p_job_id, p_owner_id, p_run_id, p_message);
$$;

revoke all on function private.claim_docling_job(bigint,bigint,uuid,text),
  private.finish_docling_job(bigint,bigint,uuid,text,text,integer,integer,jsonb,text,jsonb),
  private.fail_docling_job(bigint,bigint,uuid,text,text),
  public.claim_docling_job(bigint,bigint,uuid,text),
  public.finish_docling_job(bigint,bigint,uuid,text,text,integer,integer,jsonb,text,jsonb),
  public.fail_docling_job(bigint,bigint,uuid,text,text) from public, anon, authenticated;
grant execute on function private.claim_docling_job(bigint,bigint,uuid,text),
  private.finish_docling_job(bigint,bigint,uuid,text,text,integer,integer,jsonb,text,jsonb),
  private.fail_docling_job(bigint,bigint,uuid,text,text),
  public.claim_docling_job(bigint,bigint,uuid,text),
  public.finish_docling_job(bigint,bigint,uuid,text,text,integer,integer,jsonb,text,jsonb),
  public.fail_docling_job(bigint,bigint,uuid,text,text) to service_role;

notify pgrst, 'reload schema';
