/**
 * Scrape orchestrator.
 *
 * Flow:
 *   1. Open a scrape_runs row (status = 'running')
 *   2. Fetch all Berlin event listings for today → +28 days
 *   3. For each unique event, fetch full detail from RA
 *   4. Upsert into events table
 *   5. Close scrape_runs row with final metrics
 */

import { createSupabaseAdminClient } from "../storage/supabase";
import { logger } from "../logging/logger";
import { fetchListingsForRange, fetchEventDetail } from "./ra-graphql";
import { buildPayload, upsertEvent, type UpsertResult } from "./upsert";

// How many days ahead to scrape (Phase 1 = 4 weeks)
const SCRAPE_WINDOW_DAYS = 28;

// Delay between individual event detail fetches (ms) to be polite to RA
const DETAIL_FETCH_DELAY_MS = 300;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScrapeMetrics = {
  events_discovered: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  detail_fetch_errors: string[]; // ra_event_ids that failed
};

export type ScrapeRunResult = {
  run_id: string;
  status: "success" | "partial" | "failed";
  metrics: ScrapeMetrics;
  error?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function today(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() + n);
  return result;
}

// ─── Run log helpers ──────────────────────────────────────────────────────────

async function openScrapeRun(): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("scrape_runs")
    .insert({ status: "running", started_at: new Date().toISOString() })
    .select("run_id")
    .single();
  if (error) throw error;
  return data.run_id as string;
}

async function closeScrapeRun(
  runId: string,
  status: "success" | "partial" | "failed",
  metrics: ScrapeMetrics,
  error?: string,
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error: updateErr } = await supabase
    .from("scrape_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      metrics_json: metrics,
      error: error ?? null,
    })
    .eq("run_id", runId);
  if (updateErr) {
    logger.error({ run_id: runId, err: updateErr }, "failed to close scrape_run row");
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runScrape(): Promise<ScrapeRunResult> {
  const runLog = logger.child({ component: "scrape" });
  const from = today();
  const to = addDays(from, SCRAPE_WINDOW_DAYS);

  runLog.info(
    { from: from.toISOString(), to: to.toISOString() },
    "scrape run starting",
  );

  const runId = await openScrapeRun();
  runLog.info({ run_id: runId }, "scrape_run row opened");

  const metrics: ScrapeMetrics = {
    events_discovered: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
    detail_fetch_errors: [],
  };

  try {
    // 1. Fetch all listings for the date range
    runLog.info("fetching event listings from RA");
    const listingMap = await fetchListingsForRange(from, to);
    metrics.events_discovered = listingMap.size;
    runLog.info({ count: listingMap.size }, "listings fetched");

    // 2. For each event, fetch detail and upsert
    const eventIds = Array.from(listingMap.keys());

    for (let i = 0; i < eventIds.length; i++) {
      const raEventId = eventIds[i];
      const listing = listingMap.get(raEventId)!;
      const eventLog = runLog.child({ ra_event_id: raEventId, index: i + 1, total: eventIds.length });

      try {
        eventLog.debug("fetching event detail");
        const detail = await fetchEventDetail(raEventId);

        if (!detail) {
          eventLog.warn("event detail returned null, skipping");
          metrics.errors++;
          metrics.detail_fetch_errors.push(raEventId);
          continue;
        }

        const payload = buildPayload(detail);
        const result: UpsertResult = await upsertEvent(payload, runId);

        metrics[result.action]++;

        eventLog.info(
          { action: result.action, changed_fields: result.changed_fields },
          "event upserted",
        );
      } catch (err) {
        eventLog.error(
          { err, ra_event_id: raEventId, title: listing.title },
          "error processing event",
        );
        metrics.errors++;
        metrics.detail_fetch_errors.push(raEventId);
      }

      // Polite delay between requests (skip after last item)
      if (i < eventIds.length - 1) {
        await sleep(DETAIL_FETCH_DELAY_MS);
      }
    }

    const finalStatus: "success" | "partial" =
      metrics.errors === 0 ? "success" : "partial";

    await closeScrapeRun(runId, finalStatus, metrics);

    runLog.info({ run_id: runId, status: finalStatus, metrics }, "scrape run finished");

    return { run_id: runId, status: finalStatus, metrics };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    runLog.error({ run_id: runId, err, metrics }, "scrape run failed");

    await closeScrapeRun(runId, "failed", metrics, message);

    return { run_id: runId, status: "failed", metrics, error: message };
  }
}
