create or replace function private.complete_job_v2(
  p_job_id bigint,
  p_manifest_path text,
  p_parser_version text,
  p_page_count integer,
  p_block_count integer,
  p_quality_summary jsonb,
  p_title text,
  p_authors text[],
  p_assets jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_version_id bigint;
  v_version_number integer;
  v_asset jsonb;
  v_kind text;
  v_sequence_number integer;
  v_storage_path text;
  v_page_number integer;
  v_bounds numeric[];
begin
  if p_page_count not between 1 and 100 then
    raise exception 'Invalid page count' using errcode = '22023';
  end if;
  if p_block_count < 0 then
    raise exception 'Invalid block count' using errcode = '22023';
  end if;
  if nullif(btrim(p_manifest_path), '') is null or nullif(btrim(p_parser_version), '') is null then
    raise exception 'Parser output is incomplete' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_assets, '[]'::jsonb)) <> 'array' then
    raise exception 'Assets must be a JSON array' using errcode = '22023';
  end if;

  select *
  into v_job
  from public.processing_jobs
  where id = p_job_id and status = 'processing'
  for update;

  if not found then
    raise exception 'Active job not found' using errcode = 'P0002';
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_version_number
  from public.document_versions
  where document_id = v_job.document_id;

  insert into public.document_versions (
    document_id,
    owner_id,
    version_number,
    manifest_path,
    parser_version,
    quality_summary,
    page_count,
    block_count
  )
  values (
    v_job.document_id,
    v_job.owner_id,
    v_version_number,
    p_manifest_path,
    left(p_parser_version, 200),
    coalesce(p_quality_summary, '{}'::jsonb),
    p_page_count,
    p_block_count
  )
  returning id into v_version_id;

  for v_asset in
    select value from jsonb_array_elements(coalesce(p_assets, '[]'::jsonb))
  loop
    v_kind := v_asset ->> 'kind';
    v_sequence_number := (v_asset ->> 'sequence_number')::integer;
    v_storage_path := v_asset ->> 'storage_path';
    v_page_number := nullif(v_asset ->> 'page_number', '')::integer;

    if v_kind not in ('page', 'figure', 'table', 'formula', 'fallback')
       or v_sequence_number < 1
       or nullif(btrim(v_storage_path), '') is null then
      raise exception 'Invalid document asset' using errcode = '22023';
    end if;

    if jsonb_typeof(v_asset -> 'bounds') = 'array' then
      select array_agg(coordinate::numeric order by ordinal)
      into v_bounds
      from jsonb_array_elements_text(v_asset -> 'bounds') with ordinality as item(coordinate, ordinal);
    else
      v_bounds := null;
    end if;

    insert into public.document_assets (
      version_id,
      owner_id,
      kind,
      sequence_number,
      storage_path,
      page_number,
      bounds,
      media_type,
      alt_text
    )
    values (
      v_version_id,
      v_job.owner_id,
      v_kind,
      v_sequence_number,
      v_storage_path,
      v_page_number,
      v_bounds,
      coalesce(nullif(v_asset ->> 'media_type', ''), 'image/webp'),
      nullif(v_asset ->> 'alt_text', '')
    );
  end loop;

  update public.processing_jobs
  set status = 'ready',
      stage = 'ready',
      progress = 100,
      finished_at = now(),
      heartbeat_at = now()
  where id = p_job_id;

  update public.documents
  set status = case when published_version_id is null then 'ready' else 'published' end,
      active_version_id = v_version_id,
      title = left(coalesce(nullif(btrim(p_title), ''), title), 300),
      authors = coalesce(p_authors, '{}'),
      page_count = p_page_count
  where id = v_job.document_id and owner_id = v_job.owner_id;

  if not found then
    raise exception 'Document owner mismatch' using errcode = '42501';
  end if;

  return v_version_id;
end;
$$;

revoke all on function private.complete_job_v2(bigint, text, text, integer, integer, jsonb, text, text[], jsonb)
from public, anon, authenticated;

grant execute on function private.complete_job_v2(bigint, text, text, integer, integer, jsonb, text, text[], jsonb)
to service_role;
