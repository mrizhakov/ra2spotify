Below is a **full software design document (SDD)** for your application. It is structured so a developer or LLM can implement it **incrementally by phase**, starting from the simplest viable system.

---

# 🎧 Software Design Document

## Event → Music Vibe Generator App

---

# 1. Overview

## 1.1 Goal

Build a web application that converts music event lineups (starting with Resident Advisor events) into:

1. A **Spotify playlist representing the event’s sound**
2. A **shareable event page**
3. Later: a **short audio preview (“event vibe trailer”)**

Using Spotify as the primary music graph and playback provider.

Phase 1 is explicitly a **web app** with an RA-inspired events browsing experience: a calendar/day selector (plus “this weekend / next weekend” shortcuts) and a day-based events list that defaults to **today** and scrolls forward into upcoming days.

The UI/UX should be **mobile-first** (optimized primarily for phone screens and touch), while remaining fully usable on desktop.

---

## 1.2 Core Concept

> “Turn any DJ lineup into something you can hear in seconds.”

The system progressively evolves:

- Phase 1 → playlist generator (MVP)
- Phase 2 → multi-source event ingestion
- Phase 3 → audio preview generator (2–5 min “event trailer”)

---

# 2. System Architecture (High Level)

## Components

### 1. Frontend (Web App)

- RA-style events browsing page (calendar + day list)
- Event pages
- “Generate playlist” button
- Play / preview UI (Phase 3)

### 2. Backend API

- Event parsing
- Spotify API integration
- Playlist generation logic
- Caching layer

### 3. Data Layer

- Event cache (to avoid duplicate API calls)
- Generated playlists storage

### 4. External APIs

- Spotify Web API (core dependency)
- RA scraping module (Phase 1–2)

---

# 3. Data Model

## 3.1 Event Object

```json
{
  "id": "string",
  "source": "ra | manual | url",
  "title": "string",
  "date": "datetime",
  "location": "string",
  "lineup": ["DJ Name 1", "DJ Name 2"],
  "spotify_playlist_id": "string | null",
  "status": "unprocessed | processing | ready"
}
```

---

## 3.2 Track Object (internal use)

```json
{
  "artist": "string",
  "track_name": "string",
  "spotify_track_id": "string",
  "preview_url": "string | null",
  "source": "spotify | soundcloud",
  "weight": number
}
```

---

# 4. API Design

## 4.1 Backend Endpoints

### Event endpoints

```
GET /events/:id
```

```
POST /events/generate-playlist
```

Body:

```json
{
  "event_id": "string"
}
```

Response:

```json
{
  "playlist_url": "spotify link",
  "playlist_id": "id"
}
```

---

### Phase 2 extension:

```
POST /events/ingest
```

Body:

```json
{
  "source": "ra | url | text",
  "payload": "string"
}
```

---

### Phase 3 extension:

```
GET /events/:id/preview
```

Response:

```json
{
  "segments": [
    {
      "track": "...",
      "start": 0,
      "duration": 20,
      "source": "spotify"
    }
  ]
}
```

---

# 5. Core Logic

---

# 🟢 PHASE 1 — Spotify Playlist Generator (MVP)

## 5.1 Goal

Generate a playlist from RA event lineup on first user request.

---

## 5.2 Flow

### Step 1 — Event fetch

- Scrape RA event page OR manual input

### Step 2 — Extract lineup

```
["DJ A", "DJ B", "DJ C"]
```

---

### Step 3 — Resolve artists on Spotify

For each DJ:

Call:

```
GET /search?q={artist_name}&type=artist
```

Pick best match.

---

### Step 4 — Fetch tracks

For each artist:

- Get albums:

```
GET /artists/{id}/albums
```

- Get tracks:

```
GET /albums/{id}/tracks
```

---

### Step 5 — Rank tracks

Simple scoring:

```
score = popularity + recency_weight
```

Select:

- Top 1–2 tracks per DJ

---

### Step 6 — Create playlist (IMPORTANT)

```
POST /users/{user_id}/playlists
```

Then:

```
POST /playlists/{playlist_id}/tracks
```

---

## 5.3 Optimization requirement (important)

### Lazy generation rule:

Only generate playlist if:

```
event.spotify_playlist_id == null
AND user clicks "Generate"
```

Then cache result.

---

## 5.4 Output UX

Phase 1 is a **web app** with an RA-inspired events experience:

### Events browsing (RA-like)

- A calendar/date selector to choose a day (and/or quick picks: **This weekend**, **Next weekend**)
- A list of events for the selected day
- If no date is selected, default to **today**, and show a scrollable list grouped by day:
  - Today
  - Tomorrow
  - Next day
  - … (continue as the user scrolls)

### Event page

Event page shows:

- Button:

  > “🎧 Generate vibe playlist”

After generation:

- Link:

  > “Open in Spotify”

---

## 5.5 Key constraint handling

- Rate-limit Spotify calls
- Cache artist → track mappings
- Avoid duplicate playlist generation

---

# 🟡 PHASE 2 — Multi-source ingestion

## 6.1 Goal

Allow event input beyond RA pages.

---

## 6.2 Input types

### 1. URL ingestion

- RA event page
- external event pages

### 2. Text ingestion

Example:

```
"Event at XYZ club featuring DJ A, DJ B"
```

---

## 6.3 Processing pipeline

### Step 1 — Extract structured data

Use heuristics / LLM:

Output:

```json
{
  "title": "...",
  "lineup": ["DJ A", "DJ B"]
}
```

---

### Step 2 — Normalize artists

Same Spotify resolution pipeline as Phase 1.

---

### Step 3 — Create event object

Store in DB.

---

## 6.4 Key improvement

You are no longer dependent on:

- RA structure
- consistent HTML

---

# 🔵 PHASE 3 — 5-minute event preview generator

## 7.1 Goal

Create a **compressed audio experience of the event**

---

## 7.2 Core concept

Instead of full tracks:

- 10–15 clips total
- 15–25 seconds each
- total duration ≈ 3–5 minutes

---

## 7.3 Audio sources

### Primary:

Spotify

- `preview_url` (30s clips)

### Secondary (optional):

SoundCloud

- streamed segments (timed playback)

---

## 7.4 Algorithm

### Step 1 — Build track pool

- 1–2 tracks per DJ

---

### Step 2 — Assign weights

```
headliner: 0.5
mid: 0.3
support: 0.2
```

---

### Step 3 — Select clips

For each track:

```
clip_duration = 15–25 seconds
```

---

### Step 4 — Sequence logic

Order clips:

Option A (simple):

- headliner last (peak)

Option B (better):

- energy curve:
  - low → mid → high → peak → cooldown

---

### Step 5 — Playback engine (frontend)

Use:

- HTML5 Audio API
- simple queue system:

Pseudo:

```
play(track1)
on end → play(track2)
...
```

---

## 7.5 UX output

Event page shows:

```
🎧 3-minute vibe preview
[ Play ]
```

Then:

- auto transitions between clips
- fades between tracks (optional)

---

# 8. Frontend Design

## Events Page Layout (RA-like)

The primary user journey starts with an **events page** that looks and feels familiar to users of ra.co.

Design constraint:

- **Mobile-first** layout and interactions (tap-friendly, vertical flow), but responsive and usable on desktop.

Required behavior:

- Calendar/date selector to jump to a specific day
- Quick filters: **This weekend** and **Next weekend** (can be implemented as shortcuts that select the appropriate date range)
- If no day is selected, show **today by default**
- The events list should be scrollable into future days (today → tomorrow → next day…), grouped by day

Example layout (conceptual):

```
[Calendar / Date Picker]  [This Weekend] [Next Weekend]

== Today ==
[Event card]
[Event card]

== Tomorrow ==
[Event card]
...
```

## Event Page Layout

```
[Event Title]
[Date + Location]

🎧 Listen to the vibe
[ Generate Playlist ] → Phase 1

OR

[ Play 3-min Preview ] → Phase 3

[ Lineup list ]
[ Similar events ]
```

---

# 9. Caching Strategy (CRITICAL)

To minimize API usage:

### Cache keys:

- artist → tracks
- event → playlist
- event → preview structure

### Rule:

```
if exists(cache):
    return cached result
else:
    compute
```

---

# 10. Tech Stack Recommendation

## Frontend

- Next.js (React)

## Backend

- Node.js (Express or Fastify)

## DB

- Supabase or Postgres

## Scraping (Phase 1–2)

- Playwright

---

# 11. Risks

## 11.1 Spotify dependency

- API limits
- missing artists

## 11.2 SoundCloud inconsistency

- non-uniform track availability

## 11.3 RA scraping fragility

- HTML changes

---

# 12. Roadmap Summary

## Phase 1 (MVP)

✔ RA event → Spotify playlist
✔ Lazy generation on click
✔ Cached results

---

## Phase 2

✔ multi-source event ingestion
✔ URL/text parsing
✔ generalized event objects

---

## Phase 3

✔ 5-min “event vibe trailer”
✔ Spotify + SoundCloud clips
✔ playback sequencing engine

---

# 🧠 Final insight

Your product is evolving into:

> **A system that compresses nightlife into a listenable format.**

Not:

- a playlist tool
- not a scraper
- not a streaming app

But:

> 🎧 a “sound representation engine for real-world events”

---

If you want next, I can:

- break Phase 1 into a **step-by-step build checklist (like 2–3 day tasks)**
- or design the **exact playlist ranking algorithm so it doesn’t feel random**
- or propose a **clean UI that makes this feel like a real consumer app immediately**

That next step is where execution becomes very straightforward.
