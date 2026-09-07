-- SketchConnect schema, run this in the Supabase SQL Editor once your
-- project exists. Matches backend/app/models.py exactly — if you change
-- one, change the other.

create extension if not exists postgis;

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  location text,
  created_at timestamptz not null default now()
);

create table if not exists sketches (
  id uuid primary key default gen_random_uuid(),
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  title text,
  field_notes text,
  style text check (style in ('ink_and_wash', 'realistic', 'minimalist', 'reportage')),
  scene_type text check (scene_type in ('architectural', 'still_life_organic', 'figure', 'open_landscape', 'mixed')),
  cached_scene_analysis jsonb,
  reference_image_url text,
  final_sketch_url text,
  final_sketch_provided boolean not null default false,
  location geography(point, 4326),
  captured_at timestamptz,
  original_image_url text,
  crop_transform jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sketches_sketcher_id_idx on sketches (sketcher_id);

create table if not exists personas (
  id uuid primary key default gen_random_uuid(),
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  style text not null check (style in ('ink_and_wash', 'realistic', 'minimalist', 'reportage')),
  admired_artist_name text,
  persona_source text not null check (persona_source in ('sketcher_provided', 'system_default')),
  persona_label text not null,
  voice text not null,
  priorities jsonb not null default '[]',
  tone text not null,
  updated_at timestamptz not null default now(),
  unique (sketcher_id, style)
);

create table if not exists help_quest_log (
  id uuid primary key default gen_random_uuid(),
  sketch_id uuid not null references sketches (id) on delete cascade,
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  step_id text not null,
  question text not null,
  answer text not null,
  principle_reference text,
  created_at timestamptz not null default now()
);
create index if not exists help_quest_log_sketch_id_idx on help_quest_log (sketch_id);

create table if not exists critique_responses (
  id uuid primary key default gen_random_uuid(),
  sketch_id uuid not null references sketches (id) on delete cascade,
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  decision_trace jsonb not null default '{}',
  critique text not null,
  prior_review_summary text,
  final_sketch_provided boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists critique_responses_sketch_id_idx on critique_responses (sketch_id);

-- Row Level Security: every table is sketcher-scoped. Enable RLS and let
-- each sketcher read/write only their own rows — the FastAPI layer already
-- verifies the JWT, but RLS keeps the database safe even if a request
-- reached Postgres directly (e.g. from the Supabase dashboard's own API).
alter table profiles enable row level security;
alter table sketches enable row level security;
alter table personas enable row level security;
alter table help_quest_log enable row level security;
alter table critique_responses enable row level security;

create policy "own profile" on profiles for all using (auth.uid() = id);
create policy "own sketches" on sketches for all using (auth.uid() = sketcher_id);
create policy "own personas" on personas for all using (auth.uid() = sketcher_id);
create policy "own help quest log" on help_quest_log for all using (auth.uid() = sketcher_id);
create policy "own critiques" on critique_responses for all using (auth.uid() = sketcher_id);
