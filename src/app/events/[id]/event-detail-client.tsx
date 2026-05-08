"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type EventDetail = {
  id: string;
  title: string | null;
  description: string | null;
  date_time: string | null;
  venue: string | null;
  location: string | null;
  price: string | null;
  interested_count: number | null;
  lineup_json: string[] | null;
  status: string;
  source_url: string;
  spotify_playlist_id: string | null;
  spotify_playlist_url: string | null;
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "Date TBD";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function displayPrice(priceStr: string | null): string {
  if (!priceStr) return "Entry fee: ?";
  const lower = priceStr.toLowerCase();
  if (lower.includes("free")) return "Entry fee: Free";
  return `Entry fee: ${priceStr}`;
}

type PlaylistState =
  | { phase: "idle" }
  | { phase: "generating"; message: string }
  | { phase: "ready"; url: string }
  | { phase: "error"; message: string };

function SpotifyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function PlaylistCTA({
  event,
  onPlaylistReady,
}: {
  event: EventDetail;
  onPlaylistReady: (url: string) => void;
}) {
  const [state, setState] = useState<PlaylistState>(() => {
    if (event.spotify_playlist_url) {
      return { phase: "ready", url: event.spotify_playlist_url };
    }
    return { phase: "idle" };
  });

  const generate = useCallback(async () => {
    setState({ phase: "generating", message: "Resolving artists on Spotify…" });

    try {
      const res = await fetch("/api/events/generate-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id }),
      });

      const json = await res.json();

      if (!res.ok || json.status === "failed") {
        setState({
          phase: "error",
          message: json.error || "Generation failed",
        });
        return;
      }

      if (json.playlistUrl) {
        setState({ phase: "ready", url: json.playlistUrl });
        onPlaylistReady(json.playlistUrl);
      }
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [event.id, onPlaylistReady]);

  if (state.phase === "ready") {
    return (
      <a
        href={state.url}
        target="_blank"
        rel="noopener noreferrer"
        id="open-spotify-btn"
        className="flex items-center justify-center gap-2 w-full py-4 bg-[#1DB954] hover:bg-[#1ed760] text-black font-semibold rounded-2xl transition-all duration-300 text-base shadow-lg shadow-[#1DB954]/20 hover:shadow-[#1DB954]/40"
      >
        <SpotifyIcon className="w-5 h-5" />
        Open in Spotify
      </a>
    );
  }

  if (state.phase === "generating") {
    return (
      <button
        disabled
        className="w-full py-4 bg-surface border border-accent/30 rounded-2xl text-accent font-medium cursor-wait text-base relative overflow-hidden"
      >
        <span className="relative z-10 flex items-center justify-center gap-2">
          <span className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          {state.message}
        </span>
        <span className="absolute inset-0 bg-accent/5 animate-pulse" />
      </button>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="space-y-2">
        <button
          onClick={generate}
          id="generate-playlist-btn"
          className="w-full py-4 bg-red-900/20 border border-red-500/30 rounded-2xl text-red-400 font-medium hover:bg-red-900/30 transition-colors text-base"
        >
          ⚠️ {state.message}
          <span className="block text-xs mt-1 font-normal opacity-70">
            Tap to retry
          </span>
        </button>
      </div>
    );
  }

  // idle
  const hasArtists =
    Array.isArray(event.lineup_json) && event.lineup_json.length > 0;

  return (
    <button
      onClick={generate}
      disabled={!hasArtists}
      id="generate-playlist-btn"
      className={`w-full py-4 rounded-2xl font-medium text-base transition-all duration-300 ${
        hasArtists
          ? "bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 hover:border-accent/50 hover:shadow-lg hover:shadow-accent/10 cursor-pointer active:scale-[0.98]"
          : "bg-surface border border-border text-text-tertiary cursor-not-allowed"
      }`}
    >
      <span className="flex items-center justify-center gap-2">
        <SpotifyIcon className="w-5 h-5" />
        Generate vibe playlist
      </span>
      {!hasArtists && (
        <span className="block text-xs mt-1 font-normal opacity-60">
          No artists in lineup
        </span>
      )}
    </button>
  );
}

export function EventDetailClient({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/events/${eventId}`);
        if (res.status === 404) {
          setError("Event not found");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setEvent(json.event);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load event");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [eventId]);

  const handlePlaylistReady = useCallback(
    (url: string) => {
      if (event) {
        setEvent({ ...event, spotify_playlist_url: url });
      }
    },
    [event],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          <p className="text-sm text-text-tertiary mt-4">Loading event…</p>
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <p className="text-4xl mb-3">😵</p>
        <p className="text-text-secondary font-semibold">
          {error || "Event not found"}
        </p>
        <Link
          href="/events"
          className="mt-4 text-sm text-accent hover:underline"
        >
          ← Back to events
        </Link>
      </div>
    );
  }

  const artists = Array.isArray(event.lineup_json) ? event.lineup_json : [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header bar */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border-subtle">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/events"
            id="back-button"
            className="text-text-secondary hover:text-accent transition-colors text-sm"
          >
            ← Events
          </Link>
          <span className="text-text-tertiary text-xs font-mono ml-auto">
            {event.venue || ""}
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Title section */}
        <section className="mb-6">
          <h1
            id="event-title"
            className="text-2xl sm:text-3xl font-bold text-text-primary leading-tight"
          >
            {event.title || "Untitled Event"}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-sm text-text-secondary">
            <span>📅 {formatDateTime(event.date_time)}</span>
            {event.venue && <span>📍 {event.venue}</span>}
          </div>

          {event.location && (
            <p className="text-xs text-text-tertiary mt-1">{event.location}</p>
          )}

          <div className="flex flex-wrap gap-3 mt-4">
            <span className="text-xs bg-surface px-3 py-1.5 rounded-lg border border-border-subtle text-text-secondary">
              💰 {displayPrice(event.price)}
            </span>
            {event.interested_count != null && event.interested_count > 0 && (
              <span className="text-xs bg-surface px-3 py-1.5 rounded-lg border border-border-subtle text-text-secondary">
                ♥ {event.interested_count.toLocaleString()} interested
              </span>
            )}
            <a
              href={event.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs bg-surface px-3 py-1.5 rounded-lg border border-border-subtle text-accent hover:bg-surface-elevated transition-colors"
            >
              View on RA ↗
            </a>
          </div>
        </section>

        {/* Playlist CTA */}
        <section className="mb-8" id="playlist-section">
          <PlaylistCTA event={event} onPlaylistReady={handlePlaylistReady} />
        </section>

        {/* Lineup */}
        {artists.length > 0 && (
          <section className="mb-8" id="lineup-section">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent inline-block" />
              Lineup
            </h2>
            <div className="flex flex-wrap gap-2">
              {artists.map((name, i) => (
                <span
                  key={`${name}-${i}`}
                  className="bg-surface border border-border-subtle px-4 py-2 rounded-xl text-sm text-text-primary hover:border-accent/30 hover:bg-surface-elevated transition-colors cursor-default"
                >
                  {i === 0 && "⭐ "}
                  {name}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Description */}
        {event.description && (
          <section className="mb-8" id="description-section">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent inline-block" />
              About
            </h2>
            <div className="bg-surface rounded-2xl p-5 border border-border-subtle">
              <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                {event.description}
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
