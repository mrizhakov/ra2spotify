"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type EventItem = {
  id: string;
  title: string | null;
  date_time: string | null;
  venue: string | null;
  location: string | null;
  interested_count: number | null;
  lineup_json: string[] | null;
  price: string | null;
  status: string;
  spotify_playlist_url: string | null;
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function todayKey(): string {
  return toDateKey(new Date());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatDayLabel(dateStr: string): string {
  const today = todayKey();
  const tomorrow = toDateKey(addDays(new Date(), 1));

  if (dateStr === today) return "Today";
  if (dateStr === tomorrow) return "Tomorrow";

  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Get the upcoming Friday & Saturday for "this weekend" or "next weekend". */
function getWeekendDates(offset: 0 | 1): [Date, Date] {
  const now = new Date();
  const day = now.getDay(); // 0=Sun ... 6=Sat
  // Days until next Friday: (5 - day + 7) % 7
  let daysUntilFri = (5 - day + 7) % 7;
  if (daysUntilFri === 0 && offset === 1) daysUntilFri = 7;
  if (offset === 1) daysUntilFri += 7;
  // If today is Sat/Sun, "this weekend" is this Sat/Sun
  if (offset === 0 && (day === 6 || day === 0)) {
    // Already on weekend — show today + tomorrow
    const fri = day === 6 ? now : addDays(now, -1);
    const sun = addDays(fri, 2);
    return [fri, sun];
  }
  const fri = addDays(now, daysUntilFri);
  const sun = addDays(fri, 2);
  return [fri, sun];
}

// ─── Sorting & Formatting helpers ─────────────────────────────────────────────

export type SortOption = "interested" | "price" | "date";

export function parsePrice(priceStr: string | null): number {
  if (!priceStr) return Infinity; // No clear price -> bottom
  const lower = priceStr.toLowerCase();
  if (lower.includes("free") || lower.includes("0.00") || lower.includes("0,00")) return 0;
  
  const match = priceStr.match(/[\d]+([.,]\d+)?/);
  if (match) {
    return parseFloat(match[0].replace(',', '.'));
  }
  return Infinity;
}

export function displayPrice(priceStr: string | null): string {
  if (!priceStr) return "Entry fee: ?";
  const lower = priceStr.toLowerCase();
  if (lower.includes("free")) return "Entry fee: Free";
  return `Entry fee: ${priceStr}`;
}

// ─── Calendar strip ───────────────────────────────────────────────────────────

function CalendarStrip({
  selectedDate,
  onSelect,
}: {
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
}) {
  const days = useMemo(() => {
    const result: Date[] = [];
    const start = new Date();
    for (let i = 0; i < 28; i++) {
      result.push(addDays(start, i));
    }
    return result;
  }, []);

  return (
    <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide" id="calendar-strip">
      {days.map((d) => {
        const key = toDateKey(d);
        const isSelected = selectedDate === key;
        const isToday = key === todayKey();

        return (
          <button
            key={key}
            id={`cal-${key}`}
            onClick={() => onSelect(isSelected ? null : key)}
            className={`flex flex-col items-center min-w-[3rem] px-2 py-2 rounded-xl text-xs transition-all duration-200 shrink-0 ${
              isSelected
                ? "bg-accent text-black font-semibold shadow-lg shadow-accent/20"
                : isToday
                  ? "bg-surface-elevated text-text-primary ring-1 ring-accent/40"
                  : "bg-surface text-text-secondary hover:bg-surface-elevated"
            }`}
          >
            <span className="uppercase tracking-wider text-[10px]">
              {d.toLocaleDateString("en-GB", { weekday: "short" })}
            </span>
            <span className="text-lg font-semibold mt-0.5">{d.getDate()}</span>
            <span className="text-[10px] opacity-70">
              {d.toLocaleDateString("en-GB", { month: "short" })}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event, showDate }: { event: EventItem; showDate?: boolean }) {
  const artists = Array.isArray(event.lineup_json)
    ? event.lineup_json
    : [];

  return (
    <Link
      href={`/events/${event.id}`}
      id={`event-${event.id}`}
      className="group block bg-surface rounded-2xl p-4 border border-border-subtle hover:border-accent/30 transition-all duration-300 hover:bg-surface-elevated hover:shadow-lg hover:shadow-accent/5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Time */}
          <span className="text-xs font-mono text-accent tracking-wide">
            {showDate && event.date_time ? `${new Date(event.date_time).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })} · ` : ""}
            {formatTime(event.date_time)}
          </span>

          {/* Title */}
          <h3 className="text-base font-semibold text-text-primary mt-1 truncate group-hover:text-accent transition-colors">
            {event.title || "Untitled Event"}
          </h3>

          {/* Venue */}
          {event.venue && (
            <p className="text-sm text-text-secondary mt-0.5 truncate">
              📍 {event.venue}
            </p>
          )}

          {/* Artists */}
          {artists.length > 0 && (
            <p className="text-xs text-text-tertiary mt-2 line-clamp-1">
              {artists.slice(0, 5).join(" · ")}
              {artists.length > 5 && ` +${artists.length - 5} more`}
            </p>
          )}
        </div>

        {/* Right side: interested count + price + playlist indicator */}
        <div className="flex flex-col items-end gap-1 shrink-0 text-right">
          <span className="text-xs text-text-secondary font-medium">
            {displayPrice(event.price)}
          </span>
          {event.interested_count != null && event.interested_count > 0 && (
            <span className="text-xs text-text-tertiary">
              ♥ {event.interested_count.toLocaleString()}
            </span>
          )}
          {event.spotify_playlist_url && (
            <span className="text-[10px] bg-green-900/40 text-green-400 px-2 py-0.5 rounded-full">
              🎧 playlist
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function EventsPageClient() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [weekendRange, setWeekendRange] = useState<{ from: string; to: string } | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>("interested");

  // Fetch events
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/events");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setEvents(json.events ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load events");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Group events by day
  const grouped = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const ev of events) {
      if (!ev.date_time) continue;
      const key = ev.date_time.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    // Sort days
    const sortedKeys = Array.from(map.keys()).sort();
    return sortedKeys.map((k) => ({ date: k, events: map.get(k)! }));
  }, [events]);

  // Filter if a date or weekend is selected
  const filteredEvents = useMemo(() => {
    if (weekendRange) {
      return events.filter((ev) => ev.date_time && ev.date_time.slice(0, 10) >= weekendRange.from && ev.date_time.slice(0, 10) <= weekendRange.to);
    }
    if (!selectedDate) return events;
    return events.filter((ev) => ev.date_time && ev.date_time.slice(0, 10) === selectedDate);
  }, [events, selectedDate, weekendRange]);

  // Apply sorting and grouping based on sortOption
  const displayContent = useMemo(() => {
    if (sortOption === "date") {
      // Group by day
      const map = new Map<string, EventItem[]>();
      for (const ev of filteredEvents) {
        if (!ev.date_time) continue;
        const key = ev.date_time.slice(0, 10);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(ev);
      }
      const sortedKeys = Array.from(map.keys()).sort();
      return {
        type: "grouped" as const,
        groups: sortedKeys.map((k) => ({ date: k, events: map.get(k)! })),
      };
    } else {
      // Flat list sorted by selected criteria
      const sorted = [...filteredEvents];
      if (sortOption === "interested") {
        sorted.sort((a, b) => (b.interested_count || 0) - (a.interested_count || 0));
      } else if (sortOption === "price") {
        sorted.sort((a, b) => {
          const priceDiff = parsePrice(a.price) - parsePrice(b.price);
          if (priceDiff !== 0) return priceDiff;
          return (b.interested_count || 0) - (a.interested_count || 0);
        });
      }
      return {
        type: "flat" as const,
        events: sorted,
      };
    }
  }, [filteredEvents, sortOption]);

  // Weekend shortcuts
  const selectWeekend = useCallback(
    (offset: 0 | 1) => {
      const [fri, sun] = getWeekendDates(offset);
      const friKey = toDateKey(fri);
      const sunKey = toDateKey(sun);
      
      setSelectedDate(null);
      setWeekendRange({ from: friKey, to: sunKey });
      setSortOption("date"); // Ensure we are grouped by date to scroll
      
      setTimeout(() => {
        const match = grouped.find((g) => g.date >= friKey && g.date <= sunKey);
        if (match) {
          const el = document.getElementById(`day-${match.date}`);
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 50);
    },
    [grouped],
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border-subtle">
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold text-text-primary tracking-tight">
              <span className="text-accent">ra</span>2spotify
            </h1>
            <span className="text-xs text-text-tertiary font-mono">Berlin</span>
          </div>

          {/* Weekend shortcuts */}
          <div className="flex gap-2 mb-3">
            <button
              id="btn-this-weekend"
              onClick={() => selectWeekend(0)}
              className="px-3 py-1.5 text-xs font-medium bg-surface rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-text-primary transition-colors border border-border-subtle"
            >
              This weekend
            </button>
            <button
              id="btn-next-weekend"
              onClick={() => selectWeekend(1)}
              className="px-3 py-1.5 text-xs font-medium bg-surface rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-text-primary transition-colors border border-border-subtle"
            >
              Next weekend
            </button>
            {(selectedDate || weekendRange) && (
              <button
                id="btn-clear-filter"
                onClick={() => {
                  setSelectedDate(null);
                  setWeekendRange(null);
                }}
                className="px-3 py-1.5 text-xs font-medium bg-accent/10 rounded-lg text-accent hover:bg-accent/20 transition-colors ml-auto"
              >
                Clear filter ✕
              </button>
            )}

            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="ml-auto px-2 py-1.5 text-xs font-medium bg-surface rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-text-primary transition-colors border border-border-subtle focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="interested">Sort: Interested</option>
              <option value="price">Sort: Price</option>
              <option value="date">Sort: Date</option>
            </select>
          </div>

          {/* Calendar strip */}
          <CalendarStrip
            selectedDate={selectedDate}
            onSelect={(date) => {
              setWeekendRange(null);
              setSelectedDate(date);
            }}
          />
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            <p className="text-sm text-text-tertiary mt-4">Loading events…</p>
          </div>
        )}

        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger rounded-xl p-4 text-sm" id="error-message">
            <p className="font-semibold">Failed to load events</p>
            <p className="mt-1 opacity-80">{error}</p>
          </div>
        )}

        {!loading && !error && (displayContent.type === "grouped" ? displayContent.groups.length === 0 : displayContent.events.length === 0) && (
          <div className="text-center py-20" id="empty-state">
            <p className="text-4xl mb-3">🎧</p>
            <p className="text-text-secondary">No events found</p>
            <p className="text-xs text-text-tertiary mt-1">
              {selectedDate
                ? "Try selecting a different date"
                : "Check back later or run the scraper"}
            </p>
          </div>
        )}

        {/* Render Content */}
        {displayContent.type === "grouped" ? (
          displayContent.groups.map((group) => (
            <section key={group.date} id={`day-${group.date}`} className="mb-8">
              <div className="sticky top-[160px] z-10 bg-background/90 backdrop-blur-sm py-2 mb-3">
                <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-accent inline-block" />
                  {formatDayLabel(group.date)}
                  <span className="text-text-tertiary font-normal normal-case ml-auto text-xs">
                    {group.events.length} event{group.events.length !== 1 ? "s" : ""}
                  </span>
                </h2>
              </div>

              <div className="flex flex-col gap-3">
                {group.events.map((ev) => (
                  <EventCard key={ev.id} event={ev} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="flex flex-col gap-3">
            <div className="mb-2">
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-widest">
                {sortOption === "interested" ? "Most Interested Events" : "Events by Price"}
                {selectedDate && ` on ${formatDayLabel(selectedDate)}`}
                {weekendRange && ` for the weekend`}
              </h2>
            </div>
            {displayContent.events.map((ev) => (
              <EventCard key={ev.id} event={ev} showDate={true} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
