# Phase 1 Implementation Document

## Goal

Build the first production-shippable version of ra2spotify:

- Daily scrape Resident Advisor (RA) Berlin events for the next 4 weeks and populate/update the website.
- Web app UX similar in layout/style to the ra.co events page: calendar/day selector (plus this/next weekend shortcuts) and a day-grouped events list that defaults to today and scrolls into upcoming days.
- UI/UX is **mobile-first** (phone-primary, touch-first), but the app must remain usable on desktop.
- Generate a Spotify playlist lazily on first user request per event.
- Playlists are public (marketing/shareability) and reused by all subsequent users.
- Playlist ordering and per-artist track counts reflect artist importance (headliners first, support later).
- Add logging everywhere (scrape + generation + Spotify calls) and persist run metadata.

## Scope (Phase 1)

Included:

- RA ingestion via daily cron (Berlin-only; now → +4 weeks)
- Web app UX inspired by ra.co (events page with a calendar/day selector + list)
- Event browse page + event detail page
- Lazy playlist generation per event (idempotent)
- Track selection based on:
  - Artists mentioned on the RA event page
  - Importance derived from placement in the description + Spotify followers/popularity
  - Most listened tracks approximated via Spotify “top tracks”
- Supabase persistence for events + computed playlist composition + run logs

Excluded:

- Multi-source ingestion beyond RA
- Audio preview (Phase 3)
- User accounts / user-owned playlists

## Deployment & Runtime

- Next.js app deployed on Vercel
- Vercel Cron triggers `GET /api/cron/scrape-ra` daily
- Supabase Postgres is the primary database
- Spotify playlists are created under a single app-owned Spotify account (refresh token stored as a secret)

## Data Model (Supabase)

Create tables (via Supabase migrations) to support:

1. `events`

- Purpose: canonical event storage + playlist generation status
- Key fields:
  - `id` (uuid or stable string)
  - `source` = 'ra'
  - `source_url`
  - `ra_event_id` (unique when present)
  - `title`, `description`, `date_time`, `venue/location`, `price`, `interested_count`
  - `lineup_json` (ordered list of names)
  - `content_hash` (hash of the scraped content you care about)
  - `last_scraped_at`, `last_seen_at`
  - `status` = 'unprocessed' | 'processing' | 'ready' | 'failed'
  - `spotify_playlist_id`, `spotify_playlist_url`
  - `generation_run_id`, `generation_started_at`

2. `event_artists`

- Purpose: store extracted + resolved artists for each event and their importance tier
- Fields:
  - `event_id`, `input_name`
  - `source` = 'lineup' | 'description'
  - `lineup_position` (integer, nullable)
  - `description_first_index` (character index of first mention, nullable)
  - `mention_count` (integer)
  - Spotify resolution: `spotify_artist_id`, `spotify_followers`, `spotify_popularity`, `resolution_confidence`
  - Ranking: `importance_score` (numeric), `tier` = headliner|mid|support|unmatched

3. `event_tracks`

- Purpose: persist the exact playlist composition and ordering used for debugging and determinism
- Fields:
  - `event_id`, `spotify_track_id`, `spotify_artist_id`, `track_name`, `track_popularity`
  - `artist_tier`
  - `position_in_playlist` (1..N)

4. `artist_cache`

- Purpose: avoid repeated Spotify search calls for the same input string
- Fields:
  - `input_name` (unique)
  - `spotify_artist_id`, `canonical_name`, `confidence`, `followers`, `popularity`, `updated_at`

5. `scrape_runs`

- Purpose: durable audit trail for daily scrapes
- Fields:
  - `run_id`, `started_at`, `finished_at`, `status`
  - `metrics_json` (counts: discovered/inserted/updated/unchanged/errors)
  - `error`

6. `generation_runs`

- Purpose: durable audit trail for per-event playlist generation
- Fields:
  - `run_id`, `event_id`, `started_at`, `finished_at`, `status`
  - `unmatched_artists_json`
  - `metrics_json` (artists_resolved, tracks_selected, spotify_calls, retries, etc.)
  - `error`

Indices/constraints:

- Unique: `events.ra_event_id` (when present)
- Unique: (`events.source`, `events.source_url`) fallback
- Index: `events.date_time` for browsing
- Unique: `artist_cache.input_name`

RLS guidance:

- Public read-only access to event browsing is fine.
- Server-only operations (scrape, playlist generation) should use Supabase service role key and run only from server routes.

## RA Scraping (Berlin, +4 weeks)

### Inputs

- Berlin event listing pages (scope is intentionally narrow for Phase 1).

### Listing scrape

- Fetch listing pages and discover event URLs/IDs.
- Output: set of `{ra_event_id, source_url}`.

### Detail scrape

- For each discovered event, fetch the event page and extract:
  - title
  - date/time
  - venue/location
  - price
  - interested count
  - description
  - lineup list (ordered)

### Upsert/update logic

- Compute a `content_hash` for the extracted fields.
- Upsert by `ra_event_id` or `source_url`.
- Update mutable fields when changed.
- Always update `last_scraped_at`; update `last_seen_at` if still present in listing.

### Cron endpoint

- `GET /api/cron/scrape-ra`
- Auth: require a secret token header/query parameter.
- Writes a `scrape_runs` row at start and updates it at end.

## Playlist Generation (Lazy, Public, Deterministic)

### Trigger

- User clicks “Generate vibe playlist” on the event detail page.

### Idempotency contract

- If `events.spotify_playlist_id` exists, return it immediately.
- Otherwise:
  - Transactionally set `status='processing'` only if current status is 'unprocessed' (or retry-safe from 'failed').
  - Record `generation_run_id` + `generation_started_at`.

### Artist extraction

Candidates = artists mentioned on the event page:

- From lineup list (primary)
- From description text (secondary)
- Prefer description matches that correspond to known lineup tokens to reduce false positives.

Store per-artist features:

- lineup_position
- description_first_index and mention_count

### Spotify resolution

For each candidate artist:

- Spotify search(type=artist) using `input_name`
- Choose best match using name similarity + followers/popularity.
- Persist resolution to `event_artists` and `artist_cache`.

Note on “listens/monthly listeners”:

- Spotify Web API does not expose monthly listeners directly; treat the requirement as followers + popularity.

### Importance scoring & tiers

Compute a deterministic importance score per artist using:

- Placement signals (strong):
  - Earlier lineup position → higher score
  - Earlier description mention index → higher score
  - Higher mention_count → higher score
- Spotify signals:
  - followers (log-scaled)
  - artist popularity

Map score to tiers:

- headliner: top group
- mid: middle group
- support: rest

Persist tier and score to `event_artists`.

### Track selection

For each resolved artist:

- Fetch Spotify top tracks (represents “most listened”).

Allocate tracks per artist:

- headliner: up to 3
- mid: 2
- support: 1

Within-artist order:

- sort selected tracks by track popularity desc

Global playlist order:

- artists sorted by importance desc
- concatenate each artist’s selected tracks
- enforce total cap (e.g., 50). If over cap, trim from the tail.

Persist final ordering to `event_tracks` with `position_in_playlist`.

### Playlist creation (public)

- Create a public playlist under the app-owned Spotify account.
- Add tracks in batches.
- Persist `spotify_playlist_id` + `spotify_playlist_url` to `events` and mark ready.

Failure handling:

- Persist the error and mark event failed (or revert to unprocessed).
- Store `generation_runs` row with status and metrics.

## API Endpoints (Phase 1)

- `GET /api/events`
  - Public. Lists upcoming events.
- `GET /api/events/:id`
  - Public. Event details + playlist info if ready.
- `POST /api/events/generate-playlist`
  - Public, but rate-limited. Creates playlist lazily if missing.
- `GET /api/cron/scrape-ra`
  - Protected by secret. Runs daily scrape.

## Frontend (Phase 1)

The Phase 1 deliverable is a **web app** whose events browsing experience is similar in layout/style to the ra.co events page.

Design constraint:

- Build **mobile-first** (tap targets, vertical scrolling, minimal dense layouts) while keeping a responsive desktop layout.

### `/events` (Events browse)

Core UX requirements:

- Calendar/date selector to choose a day
- Quick picks: **This weekend** and **Next weekend**
- For the selected day, show the list of events for that day
- If no day is selected, default to **today**, and show a vertically scrollable list grouped by day:
  - Today (default)
  - Tomorrow
  - Next day
  - … (continue as the user scrolls)

Notes:

- The default view should let a user immediately scroll into future days without extra clicks.
- Selecting a day in the calendar should jump/filter the list to that day.

### `/events/:id` (Event detail)

- Show event info (title/date/venue/price/interested/description/lineup)
- Show a “Generate vibe playlist” button
- After playlist generation: show an “Open in Spotify” link

## Logging (Required)

Implement structured JSON logging everywhere.

Minimum requirements:

- All scraper invocations produce:
  - run_id, start/end, counts, error summary
  - per-event update log (changed fields list)
- All generation invocations produce:
  - run_id, event_id, tiers summary, selected tracks count
  - Spotify call logs (endpoint, status, latency, retry count)

Persist to Supabase:

- `scrape_runs` and `generation_runs` always written.
- Optionally store detailed Spotify call logs only if needed (volume can be high).

## Environment Variables / Secrets

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (client-side browsing, if needed)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only: scraping + generation)
- `RA2SPOTIFY_CRON_SECRET` (protect cron endpoint)
- Spotify:
  - `SPOTIFY_CLIENT_ID`
  - `SPOTIFY_CLIENT_SECRET`
  - `SPOTIFY_REFRESH_TOKEN` (for app-owned account)

## Verification Checklist

Manual:

- Cron scrape populates events for Berlin, next 4 weeks.
- Re-running scrape updates changed fields without duplicating events.
- Playlist generation:
  - First click creates a public playlist.
  - Subsequent clicks reuse the same playlist.
  - Ordering matches: headliners first, support last.
  - Headliners have up to 3 tracks; support have fewer.
- Logging:
  - `scrape_runs` and `generation_runs` rows are written and reflect real counts.

Automated:

- Unit test importance scoring and tier mapping.
- Unit test track allocation + global ordering.
- Integration test idempotent generation under concurrent requests (single playlist created).
