-- QuizMe v2: local-first sync. Every deck / card / review log / settings document lives on the
-- device and is mirrored here as one row. The v1 tables (quiz_sets, questions, flashcards,
-- attempts, attempt_answers) are left untouched; the app imports them once per account.

create sequence if not exists public.sync_docs_seq;

create table if not exists public.sync_docs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  collection text not null check (collection in ('decks', 'cards', 'logs', 'settings')),
  id text not null,
  data jsonb not null,
  -- Client timestamp (ms) of the edit; the newer edit wins.
  updated_at bigint not null,
  deleted boolean not null default false,
  -- Increases on every write; clients pull rows with seq greater than the last one they saw.
  seq bigint not null default nextval('public.sync_docs_seq'),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, collection, id)
);

create index if not exists sync_docs_user_seq_idx on public.sync_docs (user_id, seq);

alter table public.sync_docs enable row level security;

drop policy if exists "sync_docs: own rows" on public.sync_docs;
create policy "sync_docs: own rows" on public.sync_docs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.sync_docs to authenticated;
grant usage, select on sequence public.sync_docs_seq to authenticated;

-- Upserts a batch, keeping whichever version of each document was edited last.
-- security invoker: runs as the caller, so the RLS policy above still applies.
create or replace function public.push_docs(docs jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.sync_docs as s (user_id, collection, id, data, updated_at, deleted)
  select distinct on (d->>'collection', d->>'id')
    auth.uid(),
    d->>'collection',
    d->>'id',
    d->'data',
    (d->>'updated_at')::bigint,
    coalesce((d->>'deleted')::boolean, false)
  from jsonb_array_elements(docs) as d
  order by d->>'collection', d->>'id', (d->>'updated_at')::bigint desc
  on conflict (user_id, collection, id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at,
        deleted = excluded.deleted,
        seq = nextval('public.sync_docs_seq'),
        server_updated_at = now()
    where s.updated_at < excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.push_docs(jsonb) from public, anon;
grant execute on function public.push_docs(jsonb) to authenticated;
