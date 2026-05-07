/**
 * Playlist generation orchestrator.
 *
 * End-to-end flow: extract artists → resolve to Spotify → score & tier →
 * fetch top tracks → create playlist → add tracks → persist.
 */

import { createSupabaseAdminClient } from "@/server/storage/supabase";
import { logger } from "@/server/logging/logger";
import { resolveArtists } from "./resolve";
import { assignTiers, assemblePlaylist } from "./scoring";
import {
  getCurrentUser,
  getTopTracks,
  createPlaylist,
  addTracksToPlaylist,
  type SpotifyTrack,
} from "./client";

const TOP_TRACKS_DELAY_MS = 100;

export type GenerationResult = {
  status: "ready" | "already_exists" | "failed";
  playlistId?: string;
  playlistUrl?: string;
  error?: string;
  metrics?: {
    artistsTotal: number;
    artistsResolved: number;
    artistsUnmatched: number;
    tracksSelected: number;
    spotifyCalls: number;
    tiers: Record<string, number>;
  };
};

/**
 * Generate a Spotify playlist for the given event.
 * Idempotent: returns existing playlist if already generated.
 */
export async function generatePlaylist(
  eventId: string,
): Promise<GenerationResult> {
  const supabase = createSupabaseAdminClient();
  const log = logger.child({ component: "generate", eventId });
  let spotifyCalls = 0;

  // ── 1. Load event ───────────────────────────────────────────────────────────
  const { data: event, error: loadErr } = await supabase
    .from("events")
    .select("id,title,date_time,venue,lineup_json,status,spotify_playlist_id,spotify_playlist_url,description")
    .eq("id", eventId)
    .single();

  if (loadErr || !event) {
    log.error({ error: loadErr }, "event not found");
    return { status: "failed", error: "Event not found" };
  }

  // ── 2. Idempotency check ────────────────────────────────────────────────────
  if (event.spotify_playlist_id && event.spotify_playlist_url) {
    log.info("playlist already exists");
    return {
      status: "already_exists",
      playlistId: event.spotify_playlist_id,
      playlistUrl: event.spotify_playlist_url,
    };
  }

  // ── 3. Set status = processing ──────────────────────────────────────────────
  const runId = crypto.randomUUID();
  const { error: lockErr } = await supabase
    .from("events")
    .update({
      status: "processing",
      generation_run_id: runId,
      generation_started_at: new Date().toISOString(),
    })
    .eq("id", eventId)
    .in("status", ["unprocessed", "failed"]); // only if not already processing

  if (lockErr) {
    log.warn({ error: lockErr }, "failed to acquire processing lock");
    return { status: "failed", error: "Could not start generation (concurrent?)" };
  }

  // Create generation_runs row
  await supabase.from("generation_runs").insert({
    run_id: runId,
    event_id: eventId,
    status: "running",
  });

  try {
    // ── 4. Extract artists ──────────────────────────────────────────────────
    const lineup: string[] = Array.isArray(event.lineup_json)
      ? event.lineup_json
      : [];

    if (lineup.length === 0) {
      throw new Error("No artists in lineup");
    }

    log.info({ artistCount: lineup.length }, "starting artist resolution");

    // ── 5. Resolve artists to Spotify ───────────────────────────────────────
    const resolved = await resolveArtists(lineup);
    spotifyCalls += resolved.filter((a) => a.spotifyArtistId != null).length; // search calls

    const matched = resolved.filter((a) => a.spotifyArtistId != null);
    const unmatched = resolved.filter((a) => a.spotifyArtistId == null);

    log.info(
      { resolved: matched.length, unmatched: unmatched.length },
      "artist resolution complete",
    );

    if (matched.length === 0) {
      throw new Error("No artists could be resolved on Spotify");
    }

    // ── 6. Score and tier ───────────────────────────────────────────────────
    const tiered = assignTiers(resolved);

    const tiers: Record<string, number> = {};
    for (const a of tiered) {
      tiers[a.tier] = (tiers[a.tier] || 0) + 1;
    }
    log.info({ tiers }, "tier assignment complete");

    // ── 7. Fetch top tracks ─────────────────────────────────────────────────
    const topTracksByArtist = new Map<string, SpotifyTrack[]>();

    for (const artist of tiered) {
      if (!artist.spotifyArtistId || artist.trackAllocation === 0) continue;

      const tracks = await getTopTracks(artist.spotifyArtistId);
      topTracksByArtist.set(artist.spotifyArtistId, tracks);
      spotifyCalls++;

      await new Promise((r) => setTimeout(r, TOP_TRACKS_DELAY_MS));
    }

    // ── 8. Assemble playlist tracks ─────────────────────────────────────────
    const playlistTracks = assemblePlaylist(tiered, topTracksByArtist);

    if (playlistTracks.length === 0) {
      throw new Error("No tracks could be selected");
    }

    log.info({ trackCount: playlistTracks.length }, "playlist assembled");

    // ── 9. Create Spotify playlist ──────────────────────────────────────────
    const user = await getCurrentUser();
    spotifyCalls++;

    const dateStr = event.date_time
      ? new Date(event.date_time).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "";

    const playlistName = `${event.title || "Event"} — ra2spotify`;
    const playlistDescription = [
      event.venue && `📍 ${event.venue}`,
      dateStr && `📅 ${dateStr}`,
      `🎧 ${playlistTracks.length} tracks from ${matched.length} artists`,
      "Generated by ra2spotify.vercel.app",
    ]
      .filter(Boolean)
      .join(" · ");

    const playlist = await createPlaylist({
      userId: user.id,
      name: playlistName,
      description: playlistDescription,
    });
    spotifyCalls++;

    // ── 10. Add tracks ──────────────────────────────────────────────────────
    const trackUris = playlistTracks.map((t) => t.uri);
    await addTracksToPlaylist(playlist.id, trackUris);
    spotifyCalls++;

    log.info(
      { playlistId: playlist.id, tracks: playlistTracks.length },
      "playlist created on Spotify",
    );

    // ── 11. Persist to database ─────────────────────────────────────────────

    // Update event
    await supabase
      .from("events")
      .update({
        status: "ready",
        spotify_playlist_id: playlist.id,
        spotify_playlist_url: playlist.external_urls.spotify,
        last_error: null,
      })
      .eq("id", eventId);

    // Persist event_artists
    const artistRows = tiered.map((a) => ({
      event_id: eventId,
      input_name: a.inputName,
      source: a.source,
      lineup_position: a.lineupPosition,
      spotify_artist_id: a.spotifyArtistId,
      spotify_followers: a.followers,
      spotify_popularity: a.popularity,
      resolution_confidence: a.confidence,
      importance_score: a.importanceScore,
      tier: a.tier,
    }));

    // Clear old artist rows for this event, then insert fresh
    await supabase.from("event_artists").delete().eq("event_id", eventId);
    await supabase.from("event_artists").insert(artistRows);

    // Persist event_tracks
    const trackRows = playlistTracks.map((t) => ({
      event_id: eventId,
      spotify_track_id: t.spotifyTrackId,
      spotify_artist_id: t.spotifyArtistId,
      track_name: t.trackName,
      track_popularity: t.trackPopularity,
      artist_tier: t.artistTier,
      position_in_playlist: t.positionInPlaylist,
    }));

    await supabase.from("event_tracks").delete().eq("event_id", eventId);
    await supabase.from("event_tracks").insert(trackRows);

    // Update generation_runs
    const metrics = {
      artistsTotal: lineup.length,
      artistsResolved: matched.length,
      artistsUnmatched: unmatched.length,
      tracksSelected: playlistTracks.length,
      spotifyCalls,
      tiers,
    };

    await supabase
      .from("generation_runs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        metrics_json: metrics,
        unmatched_artists_json: unmatched.map((a) => a.inputName),
      })
      .eq("run_id", runId);

    log.info({ metrics }, "generation complete");

    return {
      status: "ready",
      playlistId: playlist.id,
      playlistUrl: playlist.external_urls.spotify,
      metrics,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ error: errorMessage }, "generation failed");

    // Mark event as failed
    await supabase
      .from("events")
      .update({ status: "failed", last_error: errorMessage })
      .eq("id", eventId);

    // Update generation_runs
    await supabase
      .from("generation_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: errorMessage,
      })
      .eq("run_id", runId);

    return { status: "failed", error: errorMessage };
  }
}
