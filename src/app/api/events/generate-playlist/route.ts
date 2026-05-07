import { NextRequest, NextResponse } from "next/server";
import { generatePlaylist } from "@/server/spotify/generate";
import { logger } from "@/server/logging/logger";

export async function POST(req: NextRequest) {
  const log = logger.child({ route: "/api/events/generate-playlist" });

  try {
    const body = await req.json();
    const eventId = body?.eventId;

    if (!eventId || typeof eventId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid eventId" },
        { status: 400 },
      );
    }

    log.info({ eventId }, "playlist generation requested");

    const result = await generatePlaylist(eventId);

    if (result.status === "failed") {
      log.error({ eventId, error: result.error }, "generation failed");
      return NextResponse.json(
        { error: result.error, status: "failed" },
        { status: 500 },
      );
    }

    log.info(
      { eventId, status: result.status, playlistId: result.playlistId },
      "generation response",
    );

    return NextResponse.json({
      status: result.status,
      playlistId: result.playlistId,
      playlistUrl: result.playlistUrl,
      metrics: result.metrics,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error({ error: message }, "unhandled error in generate-playlist");
    return NextResponse.json({ error: message, status: "failed" }, { status: 500 });
  }
}
