-- Meu Treino sem conta: o app fala só com o servidor (Vercel), que usa a chave secreta do Supabase.
-- RLS continua ligado e sem políticas: anon e authenticated não acessam nada; só o service_role.
-- Todas as linhas pertencem a um dono fixo (o app tem um único usuário).

do $$
declare
  t text;
begin
  foreach t in array array['user_settings', 'meals', 'equipment', 'plans', 'workout_sessions', 'workout_sets'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_user_id_fkey');
    execute format('alter table public.%I alter column user_id set default %L::uuid', t, '00000000-0000-0000-0000-000000000001');
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end;
$$;

create table public.foods (
  user_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  food_name text generated always as (data ->> 'nome') stored,
  primary key (user_id, id)
);

create index foods_user_updated_idx on public.foods (user_id, updated_at);
alter table public.foods enable row level security;
revoke all on table public.foods from anon, authenticated;
create trigger foods_sync_guard before insert or update on public.foods for each row execute function public.mt_sync_guard();
