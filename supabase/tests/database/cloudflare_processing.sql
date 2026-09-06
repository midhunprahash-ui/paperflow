begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);
select ok(not has_function_privilege('anon', 'public.claim_cloudflare_job(bigint,bigint,uuid,text)', 'execute'), 'Anonymous callers cannot claim jobs');
select ok(not has_function_privilege('authenticated', 'public.finish_cloudflare_job(bigint,bigint,uuid,text,text,integer,integer,jsonb)', 'execute'), 'Browser users cannot complete jobs');
select ok(has_function_privilege('service_role', 'public.finish_cloudflare_job(bigint,bigint,uuid,text,text,integer,integer,jsonb)', 'execute'), 'Server can complete jobs');

-- Use an existing owner when available; fixture identity is only for isolated local DB tests.
do $$
declare
  v_owner uuid;
  v_doc bigint;
  v_job bigint;
  v_ref text;
  v_result text;
  v_version bigint;
begin
  select id into v_owner from auth.users order by created_at limit 1;
  if v_owner is null then
    v_owner := '00000000-0000-0000-0000-000000000001';
    insert into auth.users(id) values (v_owner);
  end if;
  insert into public.documents(owner_id,title,source_filename,source_type,source_media_type,source_byte_size,status)
    values (v_owner,'Parser transaction test','test.pdf','pdf','application/pdf',20,'queued') returning id,document_ref into v_doc,v_ref;
  insert into public.processing_jobs(document_id,owner_id,attempt_number) values(v_doc,v_owner,1) returning id into v_job;
  v_result := public.claim_cloudflare_job(v_doc,v_job,v_owner,'first-run');
  if v_result <> 'claimed' then raise exception 'Initial claim failed'; end if;
  v_result := public.claim_cloudflare_job(v_doc,v_job,v_owner,'duplicate-run');
  if v_result <> 'processing' then raise exception 'Duplicate claim was not suppressed'; end if;
  update public.processing_jobs set heartbeat_at = now()-interval '6 minutes' where id=v_job;
  v_result := public.claim_cloudflare_job(v_doc,v_job,v_owner,'replacement-run');
  if v_result <> 'claimed' then raise exception 'Stale job could not resume'; end if;
  begin
    perform public.finish_cloudflare_job(v_doc,v_job,v_owner,'first-run',
      v_owner::text||'/documents/'||v_ref||'/runs/first-run/manifest.json',1,1,'{}');
    raise exception 'Old run unexpectedly completed' using errcode='XX001';
  exception when raise_exception then null;
  end;
  perform public.fail_cloudflare_job(v_doc,v_job,v_owner,'first-run','Stale failure');
  if not exists(select 1 from public.processing_jobs where id=v_job and status='processing') then
    raise exception 'Old run marked replacement failed';
  end if;
  begin
    perform public.finish_cloudflare_job(v_doc,v_job,v_owner,'replacement-run','another-owner/manifest.json',1,1,'{}');
    raise exception 'Cross-owner path accepted' using errcode='XX001';
  exception when raise_exception then null;
  end;
  update public.documents set deleted_at=now() where id=v_doc;
  begin
    perform public.finish_cloudflare_job(v_doc,v_job,v_owner,'replacement-run',
      v_owner::text||'/documents/'||v_ref||'/runs/replacement-run/manifest.json',1,1,'{}');
    raise exception 'Deleted document completed' using errcode='XX001';
  exception when raise_exception then null;
  end;
  update public.documents set deleted_at=null where id=v_doc;
  v_version := public.finish_cloudflare_job(v_doc,v_job,v_owner,'replacement-run',
    v_owner::text||'/documents/'||v_ref||'/runs/replacement-run/manifest.json',1,1,'{}');
  if not exists(select 1 from public.documents where id=v_doc and active_version_id=v_version and status='ready')
    or not exists(select 1 from public.processing_jobs where id=v_job and status='ready')
    or not exists(select 1 from public.document_versions where id=v_version and parser_version='cloudflare-ai') then
    raise exception 'Completion did not persist the version and ready states';
  end if;
end $$;
select pass('Duplicate dispatch, stale runs, owner paths, deletion, and atomic completion checked');
select * from finish();
rollback;
