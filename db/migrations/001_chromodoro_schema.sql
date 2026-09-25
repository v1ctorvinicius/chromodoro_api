-- Chromodoro API - Supabase schema v2 (multi-device sync)
-- Rode no SQL Editor do Supabase. Idempotente (pode rodar sobre o esquema v1).
-- Auth gerenciado pelo Supabase Auth (Google OAuth / email). user_id referencia auth.users(id).
-- Sync: toda linha tem client_uuid (idempotência), updated_at (LWW) e deleted_at (tombstone).

-- ============================= PROJECTS =============================
create table if not exists public.projects (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_uuid text,
  name text not null check (char_length(name) between 1 and 200),
  description text,
  status text not null default 'active' check (status in ('active','archived')),
  daily_goal_minutes double precision not null default 0 check (daily_goal_minutes >= 0),
  weekly_goal_minutes double precision not null default 0 check (weekly_goal_minutes >= 0),
  monthly_goal_minutes double precision not null default 0 check (monthly_goal_minutes >= 0),
  goal_days_of_week int[] default null check (goal_days_of_week is null or array_length(goal_days_of_week,1) <= 7),
  color int not null default 0,
  notes_md text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.projects add column if not exists client_uuid text;
alter table public.projects add column if not exists status text;
alter table public.projects add column if not exists color int;
alter table public.projects add column if not exists notes_md text;
alter table public.projects add column if not exists updated_at timestamptz;
alter table public.projects add column if not exists deleted_at timestamptz;
create unique index if not exists idx_projects_client_uuid on public.projects(user_id, client_uuid);
create index if not exists idx_projects_user on public.projects(user_id);

-- ============================= SESSIONS =============================
create table if not exists public.sessions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id bigint not null references public.projects(id) on delete cascade,
  client_uuid text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds double precision,
  status text not null default 'running' check (status in ('running','paused','completed','interrupted')),
  running_since timestamptz,
  target_seconds int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.sessions add column if not exists client_uuid text;
alter table public.sessions add column if not exists ended_at timestamptz;
alter table public.sessions add column if not exists running_since timestamptz;
alter table public.sessions add column if not exists updated_at timestamptz;
alter table public.sessions add column if not exists deleted_at timestamptz;
create unique index if not exists idx_sessions_client_uuid on public.sessions(user_id, client_uuid);
create index if not exists idx_sessions_user on public.sessions(user_id);
create index if not exists idx_sessions_project on public.sessions(project_id);

-- ============================= CONTRIBUTIONS =============================
create table if not exists public.contributions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id bigint not null references public.projects(id) on delete cascade,
  session_id bigint references public.sessions(id) on delete set null,
  client_uuid text,
  title text not null check (char_length(title) between 1 and 500),
  type text default 'focus',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.contributions add column if not exists client_uuid text;
alter table public.contributions add column if not exists updated_at timestamptz;
alter table public.contributions add column if not exists deleted_at timestamptz;
create unique index if not exists idx_contributions_client_uuid on public.contributions(user_id, client_uuid);
create index if not exists idx_contributions_user on public.contributions(user_id);

-- ============================= NOTES (novo) =============================
create table if not exists public.notes (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id bigint not null references public.projects(id) on delete cascade,
  client_uuid text,
  content text not null check (char_length(content) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.notes add column if not exists client_uuid text;
alter table public.notes add column if not exists updated_at timestamptz;
alter table public.notes add column if not exists deleted_at timestamptz;
create unique index if not exists idx_notes_client_uuid on public.notes(user_id, client_uuid);
create index if not exists idx_notes_user on public.notes(user_id);

-- ============================= USER_SETTINGS (novo) =============================
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_settings add column if not exists settings jsonb;
alter table public.user_settings add column if not exists updated_at timestamptz;

-- ============================= RLS =============================
alter table public.projects enable row level security;
alter table public.sessions enable row level security;
alter table public.contributions enable row level security;
alter table public.notes enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "user can CRUD own projects" on public.projects;
create policy "user can CRUD own projects" on public.projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user can CRUD own sessions" on public.sessions;
create policy "user can CRUD own sessions" on public.sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user can CRUD own contributions" on public.contributions;
create policy "user can CRUD own contributions" on public.contributions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user can CRUD own notes" on public.notes;
create policy "user can CRUD own notes" on public.notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user can CRUD own settings" on public.user_settings;
create policy "user can CRUD own settings" on public.user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
