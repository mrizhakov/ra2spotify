/**
 * Artist resolution: maps artist names from RA event lineups to Spotify artist IDs.
 * Uses `artist_cache` table to avoid redundant API calls.
 */

import { createSupabaseAdminClient } from "@/server/storage/supabase";
import { searchArtist, type SpotifyArtist } from "./client";
import { logger } from "@/server/logging/logger";

export type ResolvedArtist = {
  inputName: string;
  source: "lineup" | "description";
  lineupPosition: number;
  spotifyArtistId: string | null;
  canonicalName: string | null;
  confidence: number;
  followers: number;
  popularity: number;
};

// ─── Name similarity ─────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, "") // remove parenthetical (live) / (DJ set)
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

/**
 * Score how well a Spotify artist matches the input name.
 * Returns 0..1 where 1 = perfect match.
 */
function matchScore(inputName: string, candidate: SpotifyArtist): number {
  const normInput = normalize(inputName);
  const normCandidate = normalize(candidate.name);

  // Exact match
  if (normInput === normCandidate) return 1.0;

  // Substring match (one contains the other)
  if (normCandidate.includes(normInput) || normInput.includes(normCandidate)) {
    return 0.9;
  }

  // Levenshtein distance
  const maxLen = Math.max(normInput.length, normCandidate.length);
  if (maxLen === 0) return 0;
  const dist = levenshtein(normInput, normCandidate);
  const similarity = 1 - dist / maxLen;

  return similarity;
}

const MATCH_THRESHOLD = 0.6;

// ─── Cache layer ──────────────────────────────────────────────────────────────

type CachedArtist = {
  input_name: string;
  spotify_artist_id: string;
  canonical_name: string | null;
  confidence: number;
  followers: number;
  popularity: number;
};

async function getCached(inputName: string): Promise<CachedArtist | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("artist_cache")
    .select("*")
    .eq("input_name", inputName.toLowerCase().trim())
    .maybeSingle();

  if (error) {
    logger.warn({ error, inputName }, "artist_cache lookup error");
    return null;
  }
  return data as CachedArtist | null;
}

async function setCache(entry: CachedArtist): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("artist_cache")
    .upsert(
      {
        input_name: entry.input_name.toLowerCase().trim(),
        spotify_artist_id: entry.spotify_artist_id,
        canonical_name: entry.canonical_name,
        confidence: entry.confidence,
        followers: entry.followers,
        popularity: entry.popularity,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "input_name" },
    );

  if (error) {
    logger.warn({ error, inputName: entry.input_name }, "artist_cache write error");
  }
}

// ─── Resolve a single artist ─────────────────────────────────────────────────

async function resolveOne(inputName: string): Promise<{
  spotifyArtistId: string | null;
  canonicalName: string | null;
  confidence: number;
  followers: number;
  popularity: number;
}> {
  // 1. Check cache
  const cached = await getCached(inputName);
  if (cached) {
    logger.debug({ inputName, cached: true }, "artist cache hit");
    return {
      spotifyArtistId: cached.spotify_artist_id,
      canonicalName: cached.canonical_name,
      confidence: cached.confidence,
      followers: cached.followers,
      popularity: cached.popularity,
    };
  }

  // 2. Search Spotify
  const candidates = await searchArtist(inputName);
  if (candidates.length === 0) {
    logger.info({ inputName }, "no Spotify results");
    return { spotifyArtistId: null, canonicalName: null, confidence: 0, followers: 0, popularity: 0 };
  }

  // 3. Pick best match
  let bestScore = 0;
  let bestCandidate: SpotifyArtist | null = null;

  logger.info(
    { inputName, candidateCount: candidates.length, names: candidates.map(c => c.name) },
    "search candidates",
  );

  for (const c of candidates) {
    const score = matchScore(inputName, c);
    // Weight by popularity to break ties between obscure and popular artists
    // popularity can be undefined in search results — default to 0
    const pop = c.popularity ?? 0;
    const weighted = score * 0.8 + (pop / 100) * 0.2;

    logger.debug(
      { inputName, candidate: c.name, rawScore: score.toFixed(3), weighted: weighted.toFixed(3), popularity: pop },
      "candidate score",
    );

    if (weighted > bestScore) {
      bestScore = weighted;
      bestCandidate = c;
    }
  }

  if (!bestCandidate || bestScore < MATCH_THRESHOLD) {
    logger.info({ inputName, bestScore: bestScore.toFixed(3), bestName: bestCandidate?.name }, "no confident match");
    return { spotifyArtistId: null, canonicalName: null, confidence: bestScore, followers: 0, popularity: 0 };
  }

  const followers = bestCandidate.followers?.total ?? 0;
  const popularity = bestCandidate.popularity ?? 0;

  const result = {
    spotifyArtistId: bestCandidate.id,
    canonicalName: bestCandidate.name,
    confidence: bestScore,
    followers,
    popularity,
  };

  // 4. Cache for future use
  await setCache({
    input_name: inputName,
    spotify_artist_id: bestCandidate.id,
    canonical_name: bestCandidate.name,
    confidence: bestScore,
    followers,
    popularity,
  });

  logger.debug(
    { inputName, match: bestCandidate.name, score: bestScore.toFixed(3) },
    "artist resolved",
  );

  return result;
}

// ─── Resolve all artists for an event ─────────────────────────────────────────

const RESOLVE_DELAY_MS = 100; // small delay between Spotify API calls

export async function resolveArtists(
  artists: string[],
): Promise<ResolvedArtist[]> {
  const results: ResolvedArtist[] = [];

  for (let i = 0; i < artists.length; i++) {
    const name = artists[i];
    if (!name || name.trim().length === 0) continue;

    const resolved = await resolveOne(name.trim());

    results.push({
      inputName: name.trim(),
      source: "lineup",
      lineupPosition: i,
      spotifyArtistId: resolved.spotifyArtistId,
      canonicalName: resolved.canonicalName,
      confidence: resolved.confidence,
      followers: resolved.followers,
      popularity: resolved.popularity,
    });

    // Rate-limit Spotify calls
    if (i < artists.length - 1) {
      await new Promise((r) => setTimeout(r, RESOLVE_DELAY_MS));
    }
  }

  return results;
}
