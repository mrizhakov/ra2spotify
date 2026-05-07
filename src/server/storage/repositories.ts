import { createSupabaseAdminClient } from "./supabase";

export type EventRow = {
  id: string;
  source: string;
  source_url: string;
  ra_event_id: string | null;
  title: string | null;
  description: string | null;
  date_time: string | null;
  venue: string | null;
  location: string | null;
  price: string | null;
  interested_count: number | null;
  lineup_json: unknown;
  status: "unprocessed" | "processing" | "ready" | "failed";
  spotify_playlist_id: string | null;
  spotify_playlist_url: string | null;
};

export async function listEventsByDateRange(params: {
  fromInclusive: string;
  toExclusive: string;
  limit: number;
}): Promise<EventRow[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,source,source_url,ra_event_id,title,description,date_time,venue,location,price,interested_count,lineup_json,status,spotify_playlist_id,spotify_playlist_url",
    )
    .gte("date_time", params.fromInclusive)
    .lt("date_time", params.toExclusive)
    .order("date_time", { ascending: true })
    .limit(params.limit);

  if (error) throw error;
  return (data ?? []) as EventRow[];
}

export async function getEventById(eventId: string): Promise<EventRow | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,source,source_url,ra_event_id,title,description,date_time,venue,location,price,interested_count,lineup_json,status,spotify_playlist_id,spotify_playlist_url",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as EventRow | null;
}
