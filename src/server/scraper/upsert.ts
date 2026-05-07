/**
 * Upsert logic: compute content_hash and write events to Supabase.
 *
 * Upsert key priority:
 *   1. ra_event_id  (preferred — stable RA ID)
 *   2. (source, source_url) — fallback
 */

import { createHash } from "crypto";
import { createSupabaseAdminClient } from "../storage/supabase";
import { logger } from "../logging/logger";
import {
  type RaEventDetail,
  extractPrice,
  toSourceUrl,
} from "./ra-graphql";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UpsertPayload = {
  ra_event_id: string;
  source_url: string;
  title: string | null;
  description: string | null;
  date_time: string | null; // ISO string
  venue: string | null;
  location: string | null;
  price: string | null;
  interested_count: number | null;
  lineup_json: string[]; // ordered list of artist names
};

export type UpsertResult = {
  action: "inserted" | "updated" | "unchanged";
  id: string;
  ra_event_id: string;
  changed_fields: string[];
};

// ─── Content hash ─────────────────────────────────────────────────────────────

/**
 * Fields we track for change detection.
 * Mutable runtime fields (last_scraped_at etc.) are excluded.
 */
function computeContentHash(p: UpsertPayload): string {
  const stable = {
    title: p.title,
    description: p.description,
    date_time: p.date_time,
    venue: p.venue,
    location: p.location,
    price: p.price,
    interested_count: p.interested_count,
    lineup_json: p.lineup_json,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/** Convert a fully-fetched RaEventDetail into a UpsertPayload. */
export function buildPayload(detail: RaEventDetail): UpsertPayload {
  const lineup = (detail.artists ?? []).map((a) => a.name).filter(Boolean);
  return {
    ra_event_id: detail.id,
    source_url: toSourceUrl(detail.contentUrl),
    title: detail.title ?? null,
    description: detail.description ?? null,
    date_time: detail.startTime ?? null,
    venue: detail.venue?.name ?? null,
    location: detail.venue?.location ?? null,
    price: extractPrice(detail.tickets),
    interested_count: detail.interestedCount ?? null,
    lineup_json: lineup,
  };
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

export async function upsertEvent(
  payload: UpsertPayload,
  runId: string,
): Promise<UpsertResult> {
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const contentHash = computeContentHash(payload);
  const log = logger.child({ ra_event_id: payload.ra_event_id, run_id: runId });

  // --- Look up existing row ---
  const { data: existing, error: fetchErr } = await supabase
    .from("events")
    .select(
      "id, content_hash, title, description, date_time, venue, location, price, interested_count, lineup_json",
    )
    .eq("ra_event_id", payload.ra_event_id)
    .maybeSingle();

  if (fetchErr) throw fetchErr;

  if (!existing) {
    // INSERT
    const { data: inserted, error: insertErr } = await supabase
      .from("events")
      .insert({
        source: "ra",
        source_url: payload.source_url,
        ra_event_id: payload.ra_event_id,
        title: payload.title,
        description: payload.description,
        date_time: payload.date_time,
        venue: payload.venue,
        location: payload.location,
        price: payload.price,
        interested_count: payload.interested_count,
        lineup_json: payload.lineup_json,
        content_hash: contentHash,
        last_scraped_at: now,
        last_seen_at: now,
        status: "unprocessed",
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    log.info({ action: "inserted" }, "event inserted");
    return {
      action: "inserted",
      id: inserted.id,
      ra_event_id: payload.ra_event_id,
      changed_fields: [],
    };
  }

  // Row exists — check if content changed
  if (existing.content_hash === contentHash) {
    // Still update last_seen_at + last_scraped_at
    await supabase
      .from("events")
      .update({ last_scraped_at: now, last_seen_at: now })
      .eq("id", existing.id);

    log.debug({ action: "unchanged" }, "event unchanged");
    return {
      action: "unchanged",
      id: existing.id,
      ra_event_id: payload.ra_event_id,
      changed_fields: [],
    };
  }

  // Content changed — detect which fields
  const changedFields: string[] = [];
  const mutableFields = [
    "title",
    "description",
    "date_time",
    "venue",
    "location",
    "price",
    "interested_count",
    "lineup_json",
  ] as const;

  for (const field of mutableFields) {
    const prev = JSON.stringify(existing[field]);
    const next = JSON.stringify(
      field === "lineup_json" ? payload.lineup_json : payload[field],
    );
    if (prev !== next) changedFields.push(field);
  }

  const { error: updateErr } = await supabase
    .from("events")
    .update({
      title: payload.title,
      description: payload.description,
      date_time: payload.date_time,
      venue: payload.venue,
      location: payload.location,
      price: payload.price,
      interested_count: payload.interested_count,
      lineup_json: payload.lineup_json,
      content_hash: contentHash,
      last_scraped_at: now,
      last_seen_at: now,
    })
    .eq("id", existing.id);

  if (updateErr) throw updateErr;

  log.info({ action: "updated", changed_fields: changedFields }, "event updated");
  return {
    action: "updated",
    id: existing.id,
    ra_event_id: payload.ra_event_id,
    changed_fields: changedFields,
  };
}
