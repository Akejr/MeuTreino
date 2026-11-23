-- Meu Treino: tabelas sincronizadas com o app (offline primeiro).
-- Cada linha é um registro do app: id gerado no aparelho, dados completos em "data" (jsonb)
-- e algumas colunas geradas para consulta. O app só fala com o banco autenticado (RLS por usuário).

-- Grava updated_at do servidor e impede que uma alteração mais antiga sobrescreva uma mais nova.
create or replace function public.mt_sync_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.client_updated_at < old.client_updated_at then
      return old;
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create table public.user_settings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.meals (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  meal_date text generated always as (data ->> 'date') stored,
  meal_name text generated always as (data ->> 'refeicao') stored,
  primary key (user_id, id)
);

create table public.equipment (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  load_base text generated always as (data ->> 'base') stored,
  unit text generated always as (data ->> 'unidade') stored,
  primary key (user_id, id)
);

create table public.plans (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  plan_status text generated always as (data ->> 'status') stored,
  plan_version integer generated always as ((data ->> 'versao')::integer) stored,
  valid_from text generated always as (data ->> 'vigenciaInicio') stored,
  primary key (user_id, id)
);

create table public.workout_sessions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  plan_id text generated always as (data ->> 'planId') stored,
  session_key text generated always as (data ->> 'key') stored,
  session_status text generated always as (data ->> 'status') stored,
  original_date text generated always as (data ->> 'dataOriginal') stored,
  scheduled_date text generated always as (data ->> 'dataAtual') stored,
  performed_date text generated always as (data ->> 'dataReal') stored,
  duration_sec integer generated always as ((data ->> 'duracaoSeg')::integer) stored,
  primary key (user_id, id)
);

create table public.workout_sets (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  session_id text generated always as (data ->> 'sessionId') stored,
  exercise_id text generated always as (data ->> 'exerciseId') stored,
  set_kind text generated always as (data ->> 'tipo') stored,
  set_status text generated always as (data ->> 'status') stored,
  side text generated always as (data ->> 'lado') stored,
  set_position integer generated always as ((data ->> 'posicao')::integer) stored,
  performed_on text generated always as (data ->> 'data') stored,
  load numeric generated always as ((data ->> 'carga')::numeric) stored,
  reps integer generated always as ((data ->> 'reps')::integer) stored,
  rir integer generated always as ((data ->> 'rir')::integer) stored,
  primary key (user_id, id)
);

create index meals_user_updated_idx on public.meals (user_id, updated_at);
create index meals_user_date_idx on public.meals (user_id, meal_date);
create index user_settings_user_updated_idx on public.user_settings (user_id, updated_at);
create index equipment_user_updated_idx on public.equipment (user_id, updated_at);
create index plans_user_updated_idx on public.plans (user_id, updated_at);
create index workout_sessions_user_updated_idx on public.workout_sessions (user_id, updated_at);
create index workout_sessions_user_date_idx on public.workout_sessions (user_id, scheduled_date);
create index workout_sets_user_updated_idx on public.workout_sets (user_id, updated_at);
create index workout_sets_user_exercise_idx on public.workout_sets (user_id, exercise_id, performed_on);

-- Acesso: só o dono, só autenticado. Nada para anon.
do $$
declare
  t text;
begin
  foreach t in array array['user_settings', 'meals', 'equipment', 'plans', 'workout_sessions', 'workout_sets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete_own', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.mt_sync_guard()', t || '_sync_guard', t);
  end loop;
end;
$$;
