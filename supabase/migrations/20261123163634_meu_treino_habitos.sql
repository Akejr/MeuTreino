-- Hábitos diários e marcações por dia. Mesmo padrão das outras tabelas: só o servidor (service_role) acessa.

create table public.habits (
  user_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  habit_name text generated always as (data ->> 'nome') stored,
  start_date text generated always as (data ->> 'inicio') stored,
  archived_on text generated always as (data ->> 'arquivadoEm') stored,
  primary key (user_id, id)
);

create table public.habit_checks (
  user_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  habit_id text generated always as (data ->> 'habitId') stored,
  check_date text generated always as (data ->> 'date') stored,
  primary key (user_id, id)
);

create index habits_user_updated_idx on public.habits (user_id, updated_at);
create index habit_checks_user_updated_idx on public.habit_checks (user_id, updated_at);
create index habit_checks_user_habit_date_idx on public.habit_checks (user_id, habit_id, check_date);

alter table public.habits enable row level security;
alter table public.habit_checks enable row level security;
revoke all on table public.habits from anon, authenticated;
revoke all on table public.habit_checks from anon, authenticated;

create trigger habits_sync_guard before insert or update on public.habits for each row execute function public.mt_sync_guard();
create trigger habit_checks_sync_guard before insert or update on public.habit_checks for each row execute function public.mt_sync_guard();
