/**
 * GET /api/events/:id
 *
 * Public endpoint — returns a single event by its UUID.
 */

import { getEventById } from "@/server/storage/repositories";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  try {
    const event = await getEventById(id);

    if (!event) {
      return Response.json({ error: "Event not found" }, { status: 404 });
    }

    return Response.json({ event }, {
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
