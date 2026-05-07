import { EventDetailClient } from "./event-detail-client";

export const metadata = {
  title: "Event — ra2spotify",
  description: "Event details and Spotify vibe playlist.",
};

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EventDetailClient eventId={id} />;
}
