/**
 * Importance scoring and tier assignment for event artists.
 *
 * Combines placement signals (lineup position) with Spotify signals
 * (followers, popularity) to produce an importance score and tier.
 */

import type { ResolvedArtist } from "./resolve";
import type { SpotifyTrack } from "./client";

export type TieredArtist = ResolvedArtist & {
  importanceScore: number;
  tier: "headliner" | "mid" | "support" | "unmatched";
  trackAllocation: number;
};

export type PlaylistTrack = {
  spotifyTrackId: string;
  uri: string;
  trackName: string;
  trackPopularity: number;
  artistTier: "headliner" | "mid" | "support" | "unmatched";
  spotifyArtistId: string | null;
  positionInPlaylist: number;
};

// ─── Track allocation per tier ────────────────────────────────────────────────

const TRACKS_PER_TIER: Record<string, number> = {
  headliner: 3,
  mid: 2,
  support: 1,
  unmatched: 0,
};

const PLAYLIST_MAX_TRACKS = 50;

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Compute importance score for a resolved artist.
 *
 * Components:
 * - Position score (0..40): earlier lineup position → higher score
 * - Popularity score (0..30): Spotify popularity (0..100 mapped to 0..30)
 * - Follower score (0..30): log-scaled followers
 */
function computeImportanceScore(
  artist: ResolvedArtist,
  totalArtists: number,
): number {
  // Position: earlier = higher (inverted normalized position × 40)
  const positionScore =
    totalArtists > 1
      ? ((totalArtists - 1 - artist.lineupPosition) / (totalArtists - 1)) * 40
      : 40; // solo artist gets full position score

  // Spotify popularity (0..100 → 0..30)
  const popularityScore = (artist.popularity / 100) * 30;

  // Followers: log-scaled (0 → 0, 10k → ~12, 100k → ~15, 1M → ~18, 10M → ~21)
  const followerScore =
    artist.followers > 0
      ? Math.min(Math.log10(artist.followers) * 4.3, 30)
      : 0;

  return positionScore + popularityScore + followerScore;
}

// ─── Tier assignment ──────────────────────────────────────────────────────────

/**
 * Assign tiers based on score percentiles:
 * - headliner: top 20%
 * - mid: next 30%
 * - support: rest of matched artists
 * - unmatched: artists without Spotify resolution
 */
export function assignTiers(artists: ResolvedArtist[]): TieredArtist[] {
  const totalArtists = artists.length;

  // Score all artists
  const scored = artists.map((a) => ({
    ...a,
    importanceScore: computeImportanceScore(a, totalArtists),
  }));

  // Separate matched vs unmatched
  const matched = scored.filter((a) => a.spotifyArtistId != null);
  const unmatched = scored.filter((a) => a.spotifyArtistId == null);

  // Sort matched by score descending
  matched.sort((a, b) => b.importanceScore - a.importanceScore);

  const n = matched.length;
  const headlinerCutoff = Math.max(1, Math.ceil(n * 0.2));
  const midCutoff = headlinerCutoff + Math.max(1, Math.ceil(n * 0.3));

  const tiered: TieredArtist[] = [];

  for (let i = 0; i < matched.length; i++) {
    let tier: "headliner" | "mid" | "support";
    if (i < headlinerCutoff) tier = "headliner";
    else if (i < midCutoff) tier = "mid";
    else tier = "support";

    tiered.push({
      ...matched[i],
      tier,
      trackAllocation: TRACKS_PER_TIER[tier],
    });
  }

  // Add unmatched artists (no tracks)
  for (const u of unmatched) {
    tiered.push({
      ...u,
      tier: "unmatched",
      trackAllocation: 0,
    });
  }

  return tiered;
}

// ─── Track selection & playlist assembly ──────────────────────────────────────

/**
 * Select tracks for each tiered artist and assemble the final playlist.
 *
 * @param tieredArtists - Artists with tiers and allocations
 * @param topTracksByArtist - Map of Spotify artist ID → top tracks
 * @returns Ordered playlist tracks, capped at PLAYLIST_MAX_TRACKS
 */
export function assemblePlaylist(
  tieredArtists: TieredArtist[],
  topTracksByArtist: Map<string, SpotifyTrack[]>,
): PlaylistTrack[] {
  const playlist: PlaylistTrack[] = [];

  // Process artists in importance order (already sorted)
  const matched = tieredArtists
    .filter((a) => a.spotifyArtistId != null && a.trackAllocation > 0)
    .sort((a, b) => b.importanceScore - a.importanceScore);

  for (const artist of matched) {
    const tracks = topTracksByArtist.get(artist.spotifyArtistId!) ?? [];

    // Sort by popularity descending, pick top N
    const sorted = [...tracks].sort((a, b) => b.popularity - a.popularity);
    const selected = sorted.slice(0, artist.trackAllocation);

    for (const track of selected) {
      if (playlist.length >= PLAYLIST_MAX_TRACKS) break;

      playlist.push({
        spotifyTrackId: track.id,
        uri: track.uri,
        trackName: track.name,
        trackPopularity: track.popularity,
        artistTier: artist.tier,
        spotifyArtistId: artist.spotifyArtistId,
        positionInPlaylist: playlist.length + 1, // 1-indexed
      });
    }

    if (playlist.length >= PLAYLIST_MAX_TRACKS) break;
  }

  return playlist;
}
