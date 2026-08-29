create schema if not exists private;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id bigint generated always as identity primary key,
  document_ref text generated always as ('doc_' || lpad(id::text, 12, '0')) stored,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  authors text[] not null default '{}',
  source_filename text not null,
  source_type text not null constraint documents_source_type_check check (source_type in ('pdf', 'docx')),
  source_media_type text not null,
  source_byte_size bigint not null constraint documents_source_size_check check (source_byte_size between 1 and 26214400),
  source_checksum text,
  source_path text,
  status text not null default 'uploading' constraint documents_status_check check (status in ('uploading', 'queued', 'processing', 'ready', 'failed', 'published', 'deleting')),
  page_count integer constraint documents_page_count_check check (page_count between 1 and 100),
  active_version_id bigint,
  published_version_id bigint,
  public_slug text,
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (document_ref)
);

create table public.document_versions (
  id bigint generated always as identity primary key,
  version_ref text generated always as ('ver_' || lpad(id::text, 12, '0')) stored,
  document_id bigint not null,
  owner_id uuid not null,
  version_number integer not null constraint document_versions_number_check check (version_number > 0),
  manifest_path text not null,
  parser_version text not null,
  schema_version integer not null default 1,
  quality_summary jsonb not null default '{}'::jsonb,
  page_count integer constraint document_versions_page_count_check check (page_count between 1 and 100),
  block_count integer not null default 0 constraint document_versions_block_count_check check (block_count >= 0),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (document_id, version_number),
  constraint document_versions_document_owner_fkey foreign key (owner_id, document_id) references public.documents(owner_id, id) on delete cascade
);

create table public.processing_jobs (
  id bigint generated always as identity primary key,
  job_ref text generated always as ('job_' || lpad(id::text, 12, '0')) stored,
  document_id bigint not null,
  owner_id uuid not null,
  attempt_number integer not null constraint processing_jobs_attempt_check check (attempt_number > 0),
  status text not null default 'queued' constraint processing_jobs_status_check check (status in ('queued', 'processing', 'ready', 'failed')),
  stage text not null default 'queued' constraint processing_jobs_stage_check check (stage in ('queued', 'validating', 'layout', 'ocr', 'tables_formulas', 'assets', 'assembling', 'quality_check', 'ready', 'failed')),
  progress smallint not null default 0 constraint processing_jobs_progress_check check (progress between 0 and 100),
  worker_job_id text,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  constraint processing_jobs_document_owner_fkey foreign key (owner_id, document_id) references public.documents(owner_id, id) on delete cascade
);

create table public.document_assets (
  id bigint generated always as identity primary key,
  version_id bigint not null,
  owner_id uuid not null,
  kind text not null constraint document_assets_kind_check check (kind in ('page', 'figure', 'table', 'formula', 'fallback')),
  sequence_number integer not null constraint document_assets_sequence_check check (sequence_number > 0),
  storage_path text not null,
  page_number integer,
  bounds numeric[],
  media_type text not null,
  width integer,
  height integer,
  checksum text,
  alt_text text,
  created_at timestamptz not null default now(),
  unique (version_id, kind, sequence_number),
  unique (storage_path),
  constraint document_assets_version_owner_fkey foreign key (owner_id, version_id) references public.document_versions(owner_id, id) on delete cascade
);

alter table public.documents
  add constraint documents_active_version_fkey foreign key (active_version_id) references public.document_versions(id) on delete set null,
  add constraint documents_published_version_fkey foreign key (published_version_id) references public.document_versions(id) on delete set null;

create index documents_owner_updated_idx on public.documents (owner_id, updated_at desc);
create index documents_owner_active_idx on public.documents (owner_id, updated_at desc) where deleted_at is null;
create index documents_active_version_idx on public.documents (active_version_id) where active_version_id is not null;
create index documents_published_version_idx on public.documents (published_version_id) where published_version_id is not null;
create unique index documents_public_slug_idx on public.documents (public_slug) where public_slug is not null;
create index document_versions_owner_idx on public.document_versions (owner_id, document_id, version_number desc);
create index processing_jobs_owner_updated_idx on public.processing_jobs (owner_id, updated_at desc);
create index processing_jobs_document_created_idx on public.processing_jobs (document_id, created_at desc);
create unique index processing_jobs_one_active_idx on public.processing_jobs (document_id) where status in ('queued', 'processing');
create index document_assets_owner_version_idx on public.document_assets (owner_id, version_id);
create index document_assets_version_sequence_idx on public.document_assets (version_id, sequence_number);

create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger documents_set_updated_at before update on public.documents for each row execute function private.set_updated_at();
create trigger processing_jobs_set_updated_at before update on public.processing_jobs for each row execute function private.set_updated_at();

create or replace function private.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger create_profile_after_auth_user
after insert on auth.users
for each row execute function private.create_profile_for_auth_user();

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.document_assets enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy documents_select_own on public.documents for select to authenticated using ((select auth.uid()) = owner_id);
create policy versions_select_own on public.document_versions for select to authenticated using ((select auth.uid()) = owner_id);
create policy jobs_select_own on public.processing_jobs for select to authenticated using ((select auth.uid()) = owner_id);
create policy assets_select_own on public.document_assets for select to authenticated using ((select auth.uid()) = owner_id);

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.documents to authenticated;
grant select on public.document_versions, public.processing_jobs, public.document_assets to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('research-documents', 'research-documents', false, 26214400, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/json', 'image/webp', 'image/png', 'image/svg+xml'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy storage_select_own on storage.objects for select to authenticated
using (bucket_id = 'research-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy storage_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'research-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy storage_update_own on storage.objects for update to authenticated
using (bucket_id = 'research-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'research-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy storage_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'research-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Privileged implementations live outside the exposed public schema. Public RPC
-- wrappers below remain security invokers and are narrowly granted.
create or replace function private.create_document_upload_impl(
  p_filename text,
  p_media_type text,
  p_byte_size bigint,
  p_checksum text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_document public.documents;
  v_path text;
  v_mime text;
begin
  if v_owner is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_media_type not in ('pdf', 'docx') then raise exception 'Unsupported document type' using errcode = '22023'; end if;
  if p_byte_size < 1 or p_byte_size > 26214400 then raise exception 'Document exceeds the 25 MB limit' using errcode = '22023'; end if;
  if length(p_filename) < 1 or length(p_filename) > 255 then raise exception 'Invalid filename' using errcode = '22023'; end if;
  if (select count(*) from public.documents where owner_id = v_owner and deleted_at is null) >= 5 then
    raise exception 'Prototype document limit reached' using errcode = 'P0001';
  end if;
  v_mime := case p_media_type when 'pdf' then 'application/pdf' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' end;
  insert into public.documents (owner_id, title, source_filename, source_type, source_media_type, source_byte_size, source_checksum)
  values (v_owner, left(regexp_replace(p_filename, '\\.[^.]+$', '', 'i'), 300), p_filename, p_media_type, v_mime, p_byte_size, p_checksum)
  returning * into v_document;
  v_path := v_owner::text || '/documents/' || v_document.document_ref || '/source/source.' || p_media_type;
  update public.documents set source_path = v_path where id = v_document.id;
  return jsonb_build_object('document_id', v_document.id, 'document_ref', v_document.document_ref, 'storage_path', v_path);
end;
$$;

create or replace function private.enqueue_document_processing_impl(p_document_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_document public.documents;
  v_job public.processing_jobs;
  v_attempt integer;
begin
  select * into v_document from public.documents where id = p_document_id and owner_id = v_owner and deleted_at is null for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if v_document.status not in ('uploading', 'failed', 'ready', 'published') then raise exception 'Document is already processing' using errcode = 'P0001'; end if;
  select coalesce(max(attempt_number), 0) + 1 into v_attempt from public.processing_jobs where document_id = p_document_id;
  insert into public.processing_jobs (document_id, owner_id, attempt_number) values (p_document_id, v_owner, v_attempt) returning * into v_job;
  update public.documents set status = case when published_version_id is null then 'queued' else 'published' end where id = p_document_id;
  return jsonb_build_object('job_id', v_job.id, 'job_ref', v_job.job_ref);
end;
$$;

create or replace function private.publish_document_impl(p_document_id bigint, p_version_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_slug text;
begin
  if not exists (select 1 from public.document_versions where id = p_version_id and document_id = p_document_id and owner_id = v_owner) then
    raise exception 'Ready version not found' using errcode = 'P0002';
  end if;
  select public_slug into v_slug from public.documents where id = p_document_id and owner_id = v_owner for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if v_slug is null then
    select regexp_replace(lower(trim(both '-' from regexp_replace(title, '[^a-zA-Z0-9]+', '-', 'g'))), '-+', '-', 'g') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
    into v_slug from public.documents where id = p_document_id;
  end if;
  update public.documents set status = 'published', published_version_id = p_version_id, public_slug = v_slug, published_at = now() where id = p_document_id;
  return v_slug;
end;
$$;

create or replace function private.unpublish_document_impl(p_document_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.documents set status = 'ready', published_at = null where id = p_document_id and owner_id = auth.uid() and status = 'published';
$$;

create or replace function private.request_document_deletion_impl(p_document_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_path text;
begin
  update public.documents set status = 'deleting', deleted_at = now()
  where id = p_document_id and owner_id = auth.uid() and deleted_at is null
  returning source_path into v_path;
  if v_path is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  return v_path;
end;
$$;

create or replace function public.create_document_upload(
  p_filename text,
  p_media_type text,
  p_byte_size bigint,
  p_checksum text default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_document_upload_impl($1, $2, $3, $4);
$$;

create or replace function public.enqueue_document_processing(p_document_id bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.enqueue_document_processing_impl($1);
$$;

create or replace function public.publish_document(p_document_id bigint, p_version_id bigint)
returns text language sql security invoker set search_path = '' as $$
  select private.publish_document_impl($1, $2);
$$;

create or replace function public.unpublish_document(p_document_id bigint)
returns void language sql security invoker set search_path = '' as $$
  select private.unpublish_document_impl($1);
$$;

create or replace function public.request_document_deletion(p_document_id bigint)
returns text language sql security invoker set search_path = '' as $$
  select private.request_document_deletion_impl($1);
$$;

revoke all on function public.create_document_upload(text, text, bigint, text) from public, anon;
revoke all on function public.enqueue_document_processing(bigint) from public, anon;
revoke all on function public.publish_document(bigint, bigint) from public, anon;
revoke all on function public.unpublish_document(bigint) from public, anon;
revoke all on function public.request_document_deletion(bigint) from public, anon;
grant execute on function public.create_document_upload(text, text, bigint, text) to authenticated;
grant execute on function public.enqueue_document_processing(bigint) to authenticated;
grant execute on function public.publish_document(bigint, bigint) to authenticated;
grant execute on function public.unpublish_document(bigint) to authenticated;
grant execute on function public.request_document_deletion(bigint) to authenticated;

create or replace function private.mark_job_started(p_job_id bigint, p_worker_job_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.processing_jobs set status = 'processing', stage = 'validating', progress = 5, worker_job_id = p_worker_job_id, started_at = now(), heartbeat_at = now() where id = p_job_id and status = 'queued';
  if not found then raise exception 'Queued job not found'; end if;
  update public.documents d set status = case when d.published_version_id is null then 'processing' else 'published' end from public.processing_jobs j where j.id = p_job_id and d.id = j.document_id;
end; $$;

create or replace function private.update_job_progress(p_job_id bigint, p_stage text, p_progress smallint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_stage not in ('validating', 'layout', 'ocr', 'tables_formulas', 'assets', 'assembling', 'quality_check') or p_progress not between 1 and 99 then raise exception 'Invalid progress update'; end if;
  update public.processing_jobs set stage = p_stage, progress = p_progress, heartbeat_at = now() where id = p_job_id and status = 'processing';
  if not found then raise exception 'Active job not found'; end if;
end; $$;

create or replace function private.complete_job(
  p_job_id bigint, p_manifest_path text, p_parser_version text, p_page_count integer, p_block_count integer, p_quality_summary jsonb
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_job public.processing_jobs; v_version_id bigint; v_version_number integer;
begin
  select * into v_job from public.processing_jobs where id = p_job_id and status = 'processing' for update;
  if not found then raise exception 'Active job not found'; end if;
  select coalesce(max(version_number), 0) + 1 into v_version_number from public.document_versions where document_id = v_job.document_id;
  insert into public.document_versions (document_id, owner_id, version_number, manifest_path, parser_version, quality_summary, page_count, block_count)
  values (v_job.document_id, v_job.owner_id, v_version_number, p_manifest_path, p_parser_version, coalesce(p_quality_summary, '{}'::jsonb), p_page_count, p_block_count)
  returning id into v_version_id;
  update public.processing_jobs set status = 'ready', stage = 'ready', progress = 100, finished_at = now(), heartbeat_at = now() where id = p_job_id;
  update public.documents set status = case when published_version_id is null then 'ready' else 'published' end, active_version_id = v_version_id, page_count = p_page_count where id = v_job.document_id;
  return v_version_id;
end; $$;

create or replace function private.fail_job(p_job_id bigint, p_error_code text, p_error_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_document_id bigint;
begin
  update public.processing_jobs set status = 'failed', stage = 'failed', error_code = left(p_error_code, 80), error_message = left(p_error_message, 500), finished_at = now() where id = p_job_id and status in ('queued', 'processing') returning document_id into v_document_id;
  if v_document_id is not null then update public.documents set status = case when published_version_id is null then 'failed' else 'published' end where id = v_document_id; end if;
end; $$;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on function private.create_document_upload_impl(text, text, bigint, text) to authenticated;
grant execute on function private.enqueue_document_processing_impl(bigint) to authenticated;
grant execute on function private.publish_document_impl(bigint, bigint) to authenticated;
grant execute on function private.unpublish_document_impl(bigint) to authenticated;
grant execute on function private.request_document_deletion_impl(bigint) to authenticated;
grant execute on function private.mark_job_started(bigint, text) to service_role;
grant execute on function private.update_job_progress(bigint, text, smallint) to service_role;
grant execute on function private.complete_job(bigint, text, text, integer, integer, jsonb) to service_role;
grant execute on function private.fail_job(bigint, text, text) to service_role;

alter publication supabase_realtime add table public.processing_jobs;
