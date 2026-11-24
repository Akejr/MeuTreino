-- Sessões de cardio. Mesmo padrão das outras tabelas: só o servidor (service_role) acessa.
create table public.cardio_sessions (
  user_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cardio_date text generated always as (data ->> 'date') stored,
  cardio_type text generated always as (data ->> 'tipo') stored,
  primary key (user_id, id)
);

create index cardio_sessions_user_updated_idx on public.cardio_sessions (user_id, updated_at);
create index cardio_sessions_user_date_idx on public.cardio_sessions (user_id, cardio_date);

alter table public.cardio_sessions enable row level security;
revoke all on table public.cardio_sessions from anon, authenticated;

create trigger cardio_sessions_sync_guard before insert or update on public.cardio_sessions for each row execute function public.mt_sync_guard();
