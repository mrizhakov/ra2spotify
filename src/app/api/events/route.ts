/**
 * GET /api/events
 *
 * Public endpoint for listing upcoming events.
 *
 * Query params:
 *   from — ISO date string, defaults to today (UTC)
 *   to   — ISO date string, defaults to from + 28 days
 *   limit — max rows, defaults to 200
 */

import { type NextRequest } from "next/server";
import { listEventsByDateRange } from "@/server/storage/repositories";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);

  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  const fromStr = url.searchParams.get("from") ?? now.toISOString();
  const toDefault = new Date(now);
  toDefault.setUTCDate(toDefault.getUTCDate() + 28);
  const toStr = url.searchParams.get("to") ?? toDefault.toISOString();
  const limit = Math.min(
    Number(url.searchParams.get("limit") ?? 200),
    500,
  );

  try {
    const events = await listEventsByDateRange({
      fromInclusive: fromStr,
      toExclusive: toStr,
      limit,
    });

    return Response.json({ events, count: events.length }, {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
