begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select has_table('public', 'documents');
select has_table('public', 'document_versions');
select has_table('public', 'processing_jobs');
select has_table('public', 'document_assets');
select col_is_pk('public', 'profiles', 'id');
select has_index('public', 'documents', 'documents_owner_updated_idx');
select has_index('public', 'documents', 'documents_owner_active_idx');
select has_index('public', 'documents', 'documents_active_version_idx');
select has_index('public', 'documents', 'documents_published_version_idx');
select has_index('public', 'processing_jobs', 'processing_jobs_one_active_idx');
select has_index('public', 'processing_jobs', 'processing_jobs_owner_document_idx');
select has_index('public', 'document_assets', 'document_assets_version_sequence_idx');
select has_function('public', 'create_document_upload', array['text', 'text', 'bigint', 'text']);
select has_function('public', 'enqueue_document_processing', array['bigint']);
select has_function('public', 'publish_document', array['bigint', 'bigint']);
select has_function('public', 'unpublish_document', array['bigint']);
select policies_are('public', 'documents', array['documents_select_own']);
select policies_are('public', 'processing_jobs', array['jobs_select_own']);

select * from finish();
rollback;
