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
  critique_status text,
  location geography(point, 4326),
  location_label text,
  captured_at timestamptz,
  original_image_url text,
  crop_transform jsonb,
  focal_points jsonb,
  marks jsonb,
  session_choices jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sketches_sketcher_id_idx on sketches (sketcher_id);

-- Defensive column add: everything above this point in the file has only
-- ever been evolved by editing the `create table` statement directly
-- (fine for a fresh project, but a no-op against a Supabase project
-- created before this column existed). This is the first column added
-- with that in mind -- if it works out, worth doing for future additions
-- too rather than only for this one.
alter table sketches add column if not exists focal_points jsonb;
alter table sketches add column if not exists location_label text;
alter table sketches add column if not exists critique_status text;
alter table sketches add column if not exists session_choices jsonb;
alter table sketches add column if not exists marks jsonb;
-- is_draft was dropped on October 16, 2026: a sketch is shared once it has
-- a final sketch (design doc, item 30). Safe to run again.
alter table sketches drop column if exists is_draft;

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

-- My kit (design doc, item 28, October 17, 2026): one row per tool the
-- sketcher carries. Safe to run again.
create table if not exists kit_items (
  id uuid primary key default gen_random_uuid(),
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('line', 'color', 'brush', 'paper', 'extra')),
  label text not null,
  details jsonb not null default '{}',
  pigment_codes jsonb not null default '[]',
  medium text check (medium in ('watercolor', 'gouache')),
  opacity text check (opacity in ('transparent', 'opaque')),
  source text not null default 'own' check (source in ('own', 'ai')),
  pinned boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists kit_items_sketcher_id_idx on kit_items (sketcher_id);
alter table kit_items enable row level security;
drop policy if exists "own kit" on kit_items;
create policy "own kit" on kit_items for all using (auth.uid() = sketcher_id);

-- Handle renamed to username (October 21, 2026): the word sketchers see.
-- Renames the column and its index once; does nothing after that.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'profiles' and column_name = 'handle')
     and not exists (select 1 from information_schema.columns
             where table_name = 'profiles' and column_name = 'username') then
    alter table profiles rename column handle to username;
  end if;
  if exists (select 1 from pg_indexes where indexname = 'profiles_handle_key') then
    alter index profiles_handle_key rename to profiles_username_key;
  end if;
end $$;

-- The sketcher page (design doc, item 36, October 17, 2026). Safe to run again.
alter table profiles add column if not exists username text;
alter table profiles add column if not exists bio text;
alter table profiles add column if not exists links jsonb;
alter table profiles add column if not exists featured_sketch_ids jsonb;
alter table profiles add column if not exists kit_photo_url text;
create unique index if not exists profiles_username_key on profiles (username);
-- Admired sketchers are a list: one persona per name, with no style.
alter table personas alter column style drop not null;
-- Whose voice gives a sketch's feedback, picked with the final sketch.
alter table sketches add column if not exists persona_id uuid references personas (id) on delete set null;

-- Sketcher and sketch pages (design doc, items 28, 32, 33 and 36,
-- October 17, 2026). Safe to run again.
alter table kit_items drop constraint if exists kit_items_kind_check;
alter table kit_items add constraint kit_items_kind_check
  check (kind in ('line', 'ink', 'color', 'brush', 'paper', 'extra'));
alter table profiles add column if not exists favorite_paints jsonb;
alter table personas add column if not exists admired_link text;
alter table personas add column if not exists admired_location text;
alter table sketches add column if not exists palettes jsonb;

create table if not exists sketcher_follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  followed_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);
create index if not exists sketcher_follows_followed_idx on sketcher_follows (followed_id);

create table if not exists sketch_likes (
  sketch_id uuid not null references sketches (id) on delete cascade,
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sketch_id, sketcher_id)
);

create table if not exists sketch_comments (
  id uuid primary key default gen_random_uuid(),
  sketch_id uuid not null references sketches (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists sketch_comments_sketch_idx on sketch_comments (sketch_id, created_at);

alter table sketcher_follows enable row level security;
alter table sketch_likes enable row level security;
alter table sketch_comments enable row level security;
drop policy if exists "own follows" on sketcher_follows;
create policy "own follows" on sketcher_follows for all using (auth.uid() = follower_id);
drop policy if exists "own likes" on sketch_likes;
create policy "own likes" on sketch_likes for all using (auth.uid() = sketcher_id);
drop policy if exists "own comments" on sketch_comments;
create policy "own comments" on sketch_comments for all using (auth.uid() = author_id);

-- Sketch uploads: progress sketches and the final (design doc, items 35
-- and 38, October 19, 2026). Safe to run again.
create table if not exists sketch_uploads (
  id uuid primary key default gen_random_uuid(),
  sketch_id uuid not null references sketches (id) on delete cascade,
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sketch_uploads_sketch_idx on sketch_uploads (sketch_id, position);
alter table sketch_uploads enable row level security;
drop policy if exists "own uploads" on sketch_uploads;
create policy "own uploads" on sketch_uploads for all using (auth.uid() = sketcher_id);
-- Copy each existing final sketch in once, as that sketch's only upload.
insert into sketch_uploads (sketch_id, sketcher_id, url, position, created_at)
select s.id, s.sketcher_id, s.final_sketch_url, 0, coalesce(s.created_at, now())
from sketches s
where s.final_sketch_url is not null
  and not exists (select 1 from sketch_uploads u where u.sketch_id = s.id and u.url = s.final_sketch_url);

-- The Value and Color tabs (design doc, item 37, October 19, 2026). Safe
-- to run again.
alter table sketches add column if not exists value_levels integer;
alter table sketches add column if not exists gamut_mask jsonb;

-- Who can see a shared sketch, and whether its final was Glazed
-- (protecting sketchers' work, October 22, 2026). Safe to run again.
alter table sketches add column if not exists visibility text not null default 'members';
alter table sketches add column if not exists glazed boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sketches_visibility_check') then
    alter table sketches add constraint sketches_visibility_check
      check (visibility in ('members', 'followers', 'private'));
  end if;
end $$;
