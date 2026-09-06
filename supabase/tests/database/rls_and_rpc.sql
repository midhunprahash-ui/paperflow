begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select has_table('public'::name, 'documents'::name);
select has_table('public'::name, 'document_versions'::name);
select has_table('public'::name, 'processing_jobs'::name);
select has_table('public'::name, 'document_assets'::name);
select col_is_pk('public'::name, 'profiles'::name, 'id'::name);
select has_index('public'::name, 'documents'::name, 'documents_owner_updated_idx'::name);
select has_index('public'::name, 'documents'::name, 'documents_owner_active_idx'::name);
select has_index('public'::name, 'documents'::name, 'documents_active_version_idx'::name);
select has_index('public'::name, 'documents'::name, 'documents_published_version_idx'::name);
select has_index('public'::name, 'processing_jobs'::name, 'processing_jobs_one_active_idx'::name);
select has_index('public'::name, 'processing_jobs'::name, 'processing_jobs_owner_document_idx'::name);
select has_index('public'::name, 'document_assets'::name, 'document_assets_version_sequence_idx'::name);
select has_function('public', 'create_document_upload', array['text', 'text', 'bigint', 'text']);
select has_function('public', 'enqueue_document_processing', array['bigint']);
select has_function('public', 'publish_document', array['bigint', 'bigint']);
select has_function('public', 'unpublish_document', array['bigint']);
select policies_are('public', 'documents', array['documents_select_own']);
select policies_are('public', 'processing_jobs', array['jobs_select_own']);

select * from finish();
rollback;
