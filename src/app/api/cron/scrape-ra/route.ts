/**
 * Cron endpoint: GET /api/cron/scrape-ra
 *
 * Called daily by Vercel Cron (configured in vercel.json).
 * Protected by a secret token to prevent public triggering.
 *
 * Auth: Bearer token OR ?secret=... query param.
 * Token must match env var RA2SPOTIFY_CRON_SECRET.
 *
 * Max duration: 300s (Vercel Pro/Enterprise limit for cron functions).
 * The scrape is synchronous within the request — if you ever hit the limit,
 * move the heavy work to a background job / Vercel Queue.
 */

import { type NextRequest } from "next/server";
import { logger } from "@/server/logging/logger";
import { runScrape } from "@/server/scraper/run";

// Tell Next.js this is a long-running Node.js route
export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.RA2SPOTIFY_CRON_SECRET;
  if (!secret) {
    // If no secret configured, deny everything for safety
    logger.warn("RA2SPOTIFY_CRON_SECRET is not set — rejecting cron request");
    return false;
  }

  // Check Authorization header
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader === `Bearer ${secret}`) return true;

  // Vercel also supports a query param for cron jobs
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return true;

  return false;
}

export async function GET(req: NextRequest): Promise<Response> {
  const cronLog = logger.child({ route: "/api/cron/scrape-ra" });

  if (!isAuthorized(req)) {
    cronLog.warn("unauthorized cron request");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  cronLog.info("cron scrape-ra triggered");

  try {
    const result = await runScrape();

    const httpStatus = result.status === "failed" ? 500 : 200;

    cronLog.info(
      { run_id: result.run_id, status: result.status, metrics: result.metrics },
      "cron scrape-ra completed",
    );

    return Response.json(
      {
        run_id: result.run_id,
        status: result.status,
        metrics: result.metrics,
        ...(result.error ? { error: result.error } : {}),
      },
      { status: httpStatus },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    cronLog.error({ err }, "unexpected error in cron route");
    return Response.json({ error: message }, { status: 500 });
  }
}
