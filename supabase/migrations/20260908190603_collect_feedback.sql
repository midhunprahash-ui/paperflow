-- Feedback is visible only to project administrators, never to other visitors.
create table public.feedback (
  id uuid primary key,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  email text not null check (char_length(email) between 3 and 254),
  feedback text not null check (char_length(btrim(feedback)) between 5 and 4000),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
revoke all on public.feedback from public, anon, authenticated;
grant select, insert on public.feedback to service_role;
create index feedback_email_created_at_idx on public.feedback (email, created_at desc);
create index feedback_user_id_idx on public.feedback (user_id) where user_id is not null;

-- Serialize submissions per sender to make cooldown and retries safe across replicas.
create function public.submit_feedback(p_id uuid, p_name text, p_email text, p_feedback text, p_user_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(lower(p_email), 7301));
  if exists (select 1 from public.feedback where id = p_id) then
    if exists (select 1 from public.feedback where id = p_id and email = p_email
      and user_id is not distinct from p_user_id and feedback = p_feedback and name = p_name) then
      return 'accepted';
    end if;
    return 'conflict';
  end if;
  if exists (select 1 from public.feedback where email = p_email and created_at > now() - interval '30 seconds') then
    return 'rate_limited';
  end if;
  insert into public.feedback(id, name, email, feedback, user_id)
    values (p_id, p_name, p_email, p_feedback, p_user_id);
  return 'accepted';
end;
$$;
revoke all on function public.submit_feedback(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_feedback(uuid, text, text, text, uuid) to service_role;
