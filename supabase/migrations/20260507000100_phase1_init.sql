-- Phase 1 schema: events, playlist generation, run logs

create extension if not exists "pgcrypto";

-- Enums
DO $$ BEGIN
  create type public.event_status as enum ('unprocessed', 'processing', 'ready', 'failed');
EXCEPTION
  when duplicate_object then null;
END $$;

DO $$ BEGIN
  create type public.artist_tier as enum ('headliner', 'mid', 'support', 'unmatched');
EXCEPTION
  when duplicate_object then null;
END $$;

DO $$ BEGIN
  create type public.artist_source as enum ('lineup', 'description');
EXCEPTION
  when duplicate_object then null;
END $$;

-- Events
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'ra',
  source_url text not null,
  ra_event_id text,

  title text,
  description text,
  date_time timestamptz,
  venue text,
  location text,
  price text,
  interested_count integer,

  lineup_json jsonb not null default '[]'::jsonb,
  content_hash text,
  last_scraped_at timestamptz,
  last_seen_at timestamptz,

  status public.event_status not null default 'unprocessed',
  generation_run_id uuid,
  generation_started_at timestamptz,
  last_error text,

  spotify_playlist_id text,
  spotify_playlist_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists events_source_source_url_uidx on public.events (source, source_url);
create unique index if not exists events_ra_event_id_uidx on public.events (ra_event_id) where ra_event_id is not null;
create index if not exists events_date_time_idx on public.events (date_time);

-- Artists per event
create table if not exists public.event_artists (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  input_name text not null,
  source public.artist_source not null,

  lineup_position integer,
  description_first_index integer,
  mention_count integer not null default 0,

  spotify_artist_id text,
  spotify_followers integer,
  spotify_popularity integer,
  resolution_confidence numeric,

  importance_score numeric,
  tier public.artist_tier not null default 'unmatched',

  created_at timestamptz not null default now()
);

create index if not exists event_artists_event_id_idx on public.event_artists (event_id);
create index if not exists event_artists_spotify_artist_id_idx on public.event_artists (spotify_artist_id);

-- Tracks per event (final playlist composition)
create table if not exists public.event_tracks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  spotify_track_id text not null,
  spotify_artist_id text,
  track_name text,
  track_popularity integer,
  artist_tier public.artist_tier,
  position_in_playlist integer not null,

  created_at timestamptz not null default now()
);

create unique index if not exists event_tracks_event_id_position_uidx on public.event_tracks (event_id, position_in_playlist);
create index if not exists event_tracks_event_id_idx on public.event_tracks (event_id);

-- Cache: artist resolution
create table if not exists public.artist_cache (
  input_name text primary key,
  spotify_artist_id text not null,
  canonical_name text,
  confidence numeric,
  followers integer,
  popularity integer,
  updated_at timestamptz not null default now()
);

-- Run logs
create table if not exists public.scrape_runs (
  run_id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  metrics_json jsonb,
  error text
);

create table if not exists public.generation_runs (
  run_id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  unmatched_artists_json jsonb,
  metrics_json jsonb,
  error text
);

create index if not exists generation_runs_event_id_idx on public.generation_runs (event_id);

-- updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_events_updated_at on public.events;
create trigger set_events_updated_at
before update on public.events
for each row
execute function public.set_updated_at();
