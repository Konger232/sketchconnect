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
-- (Only while kit_items still has `kind`; item 44 renamed it to category.)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'kit_items' and column_name = 'kind') then
    alter table kit_items drop constraint if exists kit_items_kind_check;
    alter table kit_items add constraint kit_items_kind_check
      check (kind in ('line', 'ink', 'color', 'brush', 'paper', 'extra'));
  end if;
end $$;
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

-- The style the coach sees in the final sketch, and the sketcher's answer
-- (design doc, item 39, October 22, 2026). Safe to run again.
alter table sketches add column if not exists style_detected text;
alter table sketches add column if not exists style_confirmed boolean;

-- What's in my bag (design doc, item 44, October 22, 2026): up to 3 bag
-- photos, and each tool's pin on one. Safe to run again.
alter table profiles add column if not exists kit_photos jsonb;
update profiles set kit_photos = jsonb_build_array(kit_photo_url)
  where kit_photos is null and kit_photo_url is not null;
alter table kit_items add column if not exists spot jsonb;

-- What's in my bag, simplified (design doc, item 44, October 22, 2026).
-- kit_items keeps: category (was kind), label, note, link, spot, source.
-- Paints with pigment codes move to My palette (profiles.favorite_paints);
-- the extra fields go. Runs once: does nothing when `kind` is gone.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'kit_items' and column_name = 'kind') then
    -- 1. Paints with a pigment code join the sketcher's My palette.
    with paints(id, name, code) as (values
      ('py3', 'Hansa Yellow Light', 'PY3'),
      ('py97', 'Hansa Yellow Medium', 'PY97'),
      ('py35', 'Cadmium Yellow', 'PY35'),
      ('py150', 'Nickel Azo Yellow', 'PY150'),
      ('po49', 'Quinacridone Gold', 'PO49'),
      ('py43', 'Yellow Ochre', 'PY43'),
      ('pbr7-raw-sienna', 'Raw Sienna', 'PBr7'),
      ('pbr7-burnt-sienna', 'Burnt Sienna', 'PBr7'),
      ('pbr7-raw-umber', 'Raw Umber', 'PBr7'),
      ('pbr7-burnt-umber', 'Burnt Umber', 'PBr7'),
      ('po73', 'Pyrrol Orange', 'PO73'),
      ('po20', 'Cadmium Orange', 'PO20'),
      ('pr255', 'Pyrrol Scarlet', 'PR255'),
      ('pr108', 'Cadmium Red', 'PR108'),
      ('pr83', 'Alizarin Crimson', 'PR83'),
      ('pr264', 'Pyrrole Crimson', 'PR264'),
      ('pv19', 'Quinacridone Rose', 'PV19'),
      ('pr122', 'Quinacridone Magenta', 'PR122'),
      ('pv23', 'Dioxazine Violet', 'PV23'),
      ('pb29', 'Ultramarine Blue', 'PB29'),
      ('pb28', 'Cobalt Blue', 'PB28'),
      ('pb35', 'Cerulean Blue', 'PB35'),
      ('pb15-3', 'Phthalo Blue', 'PB15:3'),
      ('pb60', 'Indanthrone Blue', 'PB60'),
      ('pg7', 'Phthalo Green', 'PG7'),
      ('pg18', 'Viridian', 'PG18'),
      ('pg17', 'Chromium Oxide Green', 'PG17'),
      ('pbk31', 'Perylene Green', 'PBk31'),
      ('paynes-gray', 'Payne', 'PB29 + PBk9'),
      ('neutral-tint', 'Neutral Tint', 'PB15 + PV19 + PBk6'),
      ('pbk9', 'Ivory Black', 'PBk9'),
      ('pbk6', 'Lamp Black', 'PBk6'),
      ('pw6', 'Titanium White', 'PW6')
    ),
    moved as (
      select k.sketcher_id,
             coalesce(
               (select p.id from paints p where lower(k.label) like '%' || lower(p.name) || '%' limit 1),
               (select p.id from paints p where p.code = k.pigment_codes->>0 limit 1)
             ) as paint_id
      from kit_items k
      where k.kind = 'color' and jsonb_array_length(k.pigment_codes) > 0
    )
    update profiles pr
       set favorite_paints = (
         select jsonb_agg(distinct x) from (
           select jsonb_array_elements_text(coalesce(pr.favorite_paints, '[]'::jsonb)) as x
           union
           select m.paint_id from moved m where m.sketcher_id = pr.id and m.paint_id is not null
         ) s)
     where exists (select 1 from moved m where m.sketcher_id = pr.id and m.paint_id is not null);
    delete from kit_items where kind = 'color' and jsonb_array_length(pigment_codes) > 0;

    -- 2. The tip becomes its own column; a link for where to buy it.
    alter table kit_items add column if not exists note text;
    alter table kit_items add column if not exists link text;
    update kit_items set note = nullif(details->>'note', '');

    -- 3. kind becomes category, from the fixed list.
    alter table kit_items drop constraint if exists kit_items_kind_check;
    update kit_items set kind = case
      when kind = 'line' then 'pen'
      when kind = 'color' then 'palette'
      when kind = 'paper' and (label ilike '%sketchbook%' or label ilike '%journal%' or label ilike '%moleskine%') then 'sketchbook'
      when kind = 'extra' and label ilike '%clip%' then 'clips'
      when kind = 'extra' and label ilike '%easel%' then 'easel'
      when kind = 'extra' and label ilike '%bag%' then 'bag'
      when kind = 'extra' then 'other'
      else kind end;
    alter table kit_items rename column kind to category;
    alter table kit_items add constraint kit_items_category_check check (category in
      ('pen', 'ink', 'brush', 'paper', 'sketchbook', 'palette', 'clips', 'easel', 'bag', 'other'));

    -- 4. The fields no one filled in.
    alter table kit_items drop column if exists details;
    alter table kit_items drop column if exists pigment_codes;
    alter table kit_items drop column if exists medium;
    alter table kit_items drop column if exists opacity;
    alter table kit_items drop column if exists pinned;
    alter table kit_items drop column if exists hidden;
  end if;
end $$;

-- The wish list: tools a sketcher starred in someone else's bag. Only they
-- see it; it goes when the tool does.
create table if not exists kit_wishlist (
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  kit_item_id uuid not null references kit_items (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sketcher_id, kit_item_id)
);
alter table kit_wishlist enable row level security;
drop policy if exists "own wishlist" on kit_wishlist;
create policy "own wishlist" on kit_wishlist for all using (auth.uid() = sketcher_id);

-- My palette's pans, laid out like the sketcher's tin (October 22, 2026):
-- {"rows": 2, "cols": 6, "pans": [{"r", "c", "w", "h", "paint"}]}.
alter table profiles add column if not exists palette_layout jsonb;

-- ---------------------------------------------------------------------------
-- The paint library and My palette (design doc, item 46, October 22, 2026).
-- `paints` is the community library: our starter list (checked) plus the
-- paints sketchers add, unique by brand and name. `palette_items` is the
-- paints each sketcher carries, in order (this replaces
-- profiles.favorite_paints). `paint_flags` is "Report a mistake".
-- Run once; safe to run again.
create table if not exists paints (
  id text primary key,                       -- 'pb29' for ours, 'c-xxxxxxxx' for a sketcher's
  brand text,                                -- none for our generic starter paints
  name text not null,
  pigment_codes jsonb not null default '[]'::jsonb,
  hex text not null,
  lean text,
  added_by uuid references auth.users (id) on delete set null,
  checked boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists paints_brand_name on paints (lower(coalesce(brand, '')), lower(name));
alter table paints enable row level security;
drop policy if exists "anyone reads paints" on paints;
create policy "anyone reads paints" on paints for select using (true);

insert into paints (id, brand, name, pigment_codes, hex, lean, checked) values
  ('py3', null, 'Hansa Yellow Light', '["PY3"]'::jsonb, '#e6ea3c', 'yellow, leaning green (cool)', true),
  ('py97', null, 'Hansa Yellow Medium', '["PY97"]'::jsonb, '#f2c62b', 'yellow, near the middle', true),
  ('py35', null, 'Cadmium Yellow', '["PY35"]'::jsonb, '#f2c230', 'yellow, leaning orange (warm)', true),
  ('py150', null, 'Nickel Azo Yellow', '["PY150"]'::jsonb, '#d9a521', 'a muted yellow, leaning orange (warm)', true),
  ('po49', null, 'Quinacridone Gold', '["PO49"]'::jsonb, '#c98a1d', 'a muted yellow-orange (warm)', true),
  ('py43', null, 'Yellow Ochre', '["PY43"]'::jsonb, '#c8962e', 'a muted yellow, an earth (warm)', true),
  ('pbr7-raw-sienna', null, 'Raw Sienna', '["PBr7"]'::jsonb, '#b5762f', 'a muted yellow-orange, an earth (warm)', true),
  ('pbr7-burnt-sienna', null, 'Burnt Sienna', '["PBr7"]'::jsonb, '#8f4a2a', 'a muted orange-red, an earth (warm)', true),
  ('pbr7-raw-umber', null, 'Raw Umber', '["PBr7"]'::jsonb, '#5e4a36', 'a dull brown, leaning green (cool earth)', true),
  ('pbr7-burnt-umber', null, 'Burnt Umber', '["PBr7"]'::jsonb, '#4e3424', 'a dark brown, leaning red (warm earth)', true),
  ('po73', null, 'Pyrrol Orange', '["PO73"]'::jsonb, '#e2582a', 'orange, leaning red (warm)', true),
  ('po20', null, 'Cadmium Orange', '["PO20"]'::jsonb, '#e86f2a', 'orange (warm)', true),
  ('pr255', null, 'Pyrrol Scarlet', '["PR255"]'::jsonb, '#d33a2c', 'red, leaning orange (warm)', true),
  ('pr108', null, 'Cadmium Red', '["PR108"]'::jsonb, '#c8322b', 'red, leaning orange (warm)', true),
  ('pr83', null, 'Alizarin Crimson', '["PR83"]'::jsonb, '#9e1f3a', 'red, leaning blue (cool)', true),
  ('pr264', null, 'Pyrrole Crimson', '["PR264"]'::jsonb, '#b22a3c', 'red, leaning blue (cool)', true),
  ('pv19', null, 'Quinacridone Rose', '["PV19"]'::jsonb, '#c23b6e', 'pink-red, leaning blue (cool)', true),
  ('pr122', null, 'Quinacridone Magenta', '["PR122"]'::jsonb, '#a8326b', 'magenta, leaning violet (cool)', true),
  ('pv23', null, 'Dioxazine Violet', '["PV23"]'::jsonb, '#4b2c6e', 'violet, leaning blue (cool)', true),
  ('pb29', null, 'Ultramarine Blue', '["PB29"]'::jsonb, '#24359a', 'blue, leaning violet (warm)', true),
  ('pb28', null, 'Cobalt Blue', '["PB28"]'::jsonb, '#2f5aa8', 'blue, near the middle', true),
  ('pb35', null, 'Cerulean Blue', '["PB35"]'::jsonb, '#3a86b8', 'blue, leaning green (cool)', true),
  ('pb15-3', null, 'Phthalo Blue', '["PB15:3"]'::jsonb, '#0f5e9c', 'blue, leaning green (cool)', true),
  ('pb60', null, 'Indanthrone Blue', '["PB60"]'::jsonb, '#253b6e', 'a dark blue, leaning violet (warm)', true),
  ('pg7', null, 'Phthalo Green', '["PG7"]'::jsonb, '#11695a', 'green, leaning blue (cool)', true),
  ('pg18', null, 'Viridian', '["PG18"]'::jsonb, '#1f7a62', 'green, leaning blue (cool)', true),
  ('pg17', null, 'Chromium Oxide Green', '["PG17"]'::jsonb, '#5f7a45', 'a muted green, leaning yellow (warm)', true),
  ('pbk31', null, 'Perylene Green', '["PBk31"]'::jsonb, '#2f3b33', 'a very dark green, near black', true),
  ('paynes-gray', null, 'Payne''s Gray', '["PB29","PBk9"]'::jsonb, '#4b5560', 'a blue-grey (cool)', true),
  ('neutral-tint', null, 'Neutral Tint', '["PB15","PV19","PBk6"]'::jsonb, '#3d3b40', 'a neutral grey-black', true),
  ('pbk9', null, 'Ivory Black', '["PBk9"]'::jsonb, '#2a2725', 'a warm black', true),
  ('pbk6', null, 'Lamp Black', '["PBk6"]'::jsonb, '#1f1f1f', 'a cool black', true),
  ('pw6', null, 'Titanium White', '["PW6"]'::jsonb, '#f4f2ec', 'white', true)
on conflict (id) do nothing;

create table if not exists palette_items (
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  paint_id text not null references paints (id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (sketcher_id, paint_id)
);
alter table palette_items enable row level security;
drop policy if exists "anyone reads palettes" on palette_items;
create policy "anyone reads palettes" on palette_items for select using (true);

create table if not exists paint_flags (
  paint_id text not null references paints (id) on delete cascade,
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  note text,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (paint_id, sketcher_id)
);
alter table paint_flags enable row level security;

-- Move each sketcher's favorite_paints into palette_items, in order.
insert into palette_items (sketcher_id, paint_id, position)
select p.id, v.paint_id, (v.ord - 1)::int
from profiles p
cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(p.favorite_paints::jsonb) = 'array' then p.favorite_paints::jsonb else '[]'::jsonb end
) with ordinality as v(paint_id, ord)
where exists (select 1 from paints x where x.id = v.paint_id)
on conflict do nothing;

-- Opacity, as printed on the tube (October 23, 2026). Empty for our
-- starter paints until it is filled in.
alter table paints add column if not exists opacity text
  check (opacity in ('transparent', 'semi_transparent', 'semi_opaque', 'opaque'));

-- Opacity for our starter paints (October 23, 2026). Single pigments as
-- Winsor & Newton Professional or Daniel Smith Extra Fine rate them; the
-- cadmiums, Phthalo Blue and Lamp Black are opaque or transparent in every
-- maker's chart. Only fills paints that have none yet.
update paints p set opacity = v.opacity
from (values
  ('py3', 'semi_transparent'),
  ('py97', 'semi_transparent'),
  ('py35', 'opaque'),
  ('py150', 'transparent'),
  ('po49', 'transparent'),
  ('py43', 'semi_opaque'),
  ('pbr7-raw-sienna', 'transparent'),
  ('pbr7-burnt-sienna', 'transparent'),
  ('pbr7-raw-umber', 'transparent'),
  ('pbr7-burnt-umber', 'transparent'),
  ('po73', 'semi_transparent'),
  ('po20', 'opaque'),
  ('pr255', 'semi_transparent'),
  ('pr108', 'opaque'),
  ('pr83', 'transparent'),
  ('pr264', 'semi_transparent'),
  ('pv19', 'transparent'),
  ('pr122', 'transparent'),
  ('pv23', 'transparent'),
  ('pb29', 'transparent'),
  ('pb28', 'semi_transparent'),
  ('pb35', 'semi_opaque'),
  ('pb15-3', 'transparent'),
  ('pb60', 'transparent'),
  ('pg7', 'transparent'),
  ('pg18', 'transparent'),
  ('pg17', 'opaque'),
  ('pbk31', 'transparent'),
  ('paynes-gray', 'semi_opaque'),
  ('neutral-tint', 'opaque'),
  ('pbk9', 'opaque'),
  ('pbk6', 'opaque'),
  ('pw6', 'opaque')
) as v(id, opacity)
where p.id = v.id and p.opacity is null;

-- ---------------------------------------------------------------------------
-- Events and scouted spots (design doc, items 49 and 50; October 26, 2026).
-- Run once; safe to run again.

-- A sketch crawl or an organised event, always at a real place.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('crawl', 'organised')),
  event_type text not null default 'crawl' check (event_type in ('crawl', 'workshop', 'symposium', 'festival')),
  title text not null check (char_length(title) between 1 and 150),
  description text,
  theme text,
  hashtag text not null,                    -- without the #, unique ignoring case
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_zone text not null default 'UTC',    -- the event's own, for showing its times
  place_name text not null,
  location geography(Point, 4326) not null,
  spot_id uuid,                             -- the scouted spot it started from, if any
  org_name text,
  org_url text,
  cover_image_url text,
  website_url text,                         -- the official site or brochure
  ticket_url text,
  hidden boolean not null default false,    -- 3 reports hide it until reviewed
  created_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);
create unique index if not exists events_hashtag on events (lower(hashtag));
create index if not exists events_location on events using gist (location);
create index if not exists events_starts on events (starts_at);
alter table events enable row level security;
drop policy if exists "anyone reads events" on events;
create policy "anyone reads events" on events for select using (not hidden);

-- Featured instructors: on SketchConnect (they confirm) or a plain name.
create table if not exists event_instructors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  sketcher_id uuid references auth.users (id) on delete cascade,
  name text,                                -- an instructor not on SketchConnect
  status text not null default 'invited' check (status in ('invited', 'confirmed', 'declined')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check (sketcher_id is not null or name is not null)
);
create unique index if not exists event_instructors_one on event_instructors (event_id, sketcher_id) where sketcher_id is not null;
alter table event_instructors enable row level security;

create table if not exists event_interest (
  event_id uuid not null references events (id) on delete cascade,
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, sketcher_id)
);
alter table event_interest enable row level security;

create table if not exists event_reports (
  event_id uuid not null references events (id) on delete cascade,
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (event_id, sketcher_id)
);
alter table event_reports enable row level security;

create table if not exists event_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists event_comments_event_idx on event_comments (event_id, created_at);
alter table event_comments enable row level security;

-- Sketches the organiser hid from the event's page.
create table if not exists event_hidden_sketches (
  event_id uuid not null references events (id) on delete cascade,
  sketch_id uuid not null references sketches (id) on delete cascade,
  primary key (event_id, sketch_id)
);
alter table event_hidden_sketches enable row level security;

-- Hashtags in a sketch's title and field notes, lower case, without the #.
create table if not exists sketch_tags (
  sketch_id uuid not null references sketches (id) on delete cascade,
  tag text not null,
  primary key (sketch_id, tag)
);
create index if not exists sketch_tags_tag on sketch_tags (tag);
alter table sketch_tags enable row level security;

alter table profiles add column if not exists show_attending_events boolean not null default false;

-- Scouted spots: a place and its photos, private by default.
create table if not exists spots (
  id uuid primary key default gen_random_uuid(),
  sketcher_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  note text,
  place_name text,
  location geography(Point, 4326),
  visibility text not null default 'private' check (visibility in ('private', 'followers')),
  created_at timestamptz not null default now()
);
create index if not exists spots_sketcher on spots (sketcher_id);
alter table spots enable row level security;

create table if not exists spot_photos (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references spots (id) on delete cascade,
  image_url text not null,
  taken_at timestamptz,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
alter table spot_photos enable row level security;

-- Hashtags already in sketches' titles and field notes (once).
insert into sketch_tags (sketch_id, tag)
select s.id, lower(m[1])
from sketches s
cross join lateral regexp_matches(coalesce(s.title, '') || ' ' || coalesce(s.field_notes, ''), '#([A-Za-z0-9_]{2,40})', 'g') as m
on conflict do nothing;
