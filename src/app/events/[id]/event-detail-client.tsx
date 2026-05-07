"use client";

import { useState, useEffect } from "react";
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
        <p className="text-text-secondary font-semibold">{error || "Event not found"}</p>
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
            {event.price && (
              <span className="text-xs bg-surface px-3 py-1.5 rounded-lg border border-border-subtle text-text-secondary">
                💰 {event.price}
              </span>
            )}
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
          {event.spotify_playlist_url ? (
            <a
              href={event.spotify_playlist_url}
              target="_blank"
              rel="noopener noreferrer"
              id="open-spotify-btn"
              className="flex items-center justify-center gap-2 w-full py-4 bg-[#1DB954] hover:bg-[#1ed760] text-black font-semibold rounded-2xl transition-all duration-300 text-base shadow-lg shadow-[#1DB954]/20 hover:shadow-[#1DB954]/40"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              Open in Spotify
            </a>
          ) : (
            <button
              id="generate-playlist-btn"
              disabled
              className="w-full py-4 bg-surface border border-border rounded-2xl text-text-tertiary font-medium cursor-not-allowed text-base"
              title="Playlist generation coming soon"
            >
              🎧 Generate vibe playlist
              <span className="block text-xs mt-1 font-normal opacity-60">
                Coming soon — Spotify integration in progress
              </span>
            </button>
          )}
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
