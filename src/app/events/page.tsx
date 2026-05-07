import { EventsPageClient } from "./events-client";

export const metadata = {
  title: "Events — ra2spotify",
  description: "Browse upcoming Berlin club events and generate Spotify vibes playlists.",
};

export default function EventsPage() {
  return <EventsPageClient />;
}
