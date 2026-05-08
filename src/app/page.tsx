import Link from "next/link";

export const metadata = {
  title: "ra2spotify — Listen to Berlin event lineups",
  description:
    "Browse upcoming Berlin events and instantly generate Spotify playlists from the lineup.",
};

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-10 sm:py-14">
        <header className="mb-10">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-text-primary tracking-tight">
              <span className="text-accent">ra</span>2spotify
            </h1>
            <span className="text-xs text-text-tertiary font-mono">Berlin</span>
          </div>
        </header>

        <section className="bg-surface rounded-3xl border border-border-subtle p-6 sm:p-8">
          <h2 className="text-3xl sm:text-4xl font-bold text-text-primary leading-tight">
            Turn event lineups into something you can listen to.
          </h2>
          <p className="mt-4 text-text-secondary text-base leading-relaxed">
            Browse upcoming Berlin events, generate a Spotify playlist from the lineup,
            then listen instantly.
          </p>

          <div className="mt-6">
            <Link
              href="/events"
              id="landing-cta"
              className="inline-flex items-center justify-center w-full sm:w-auto px-6 py-4 rounded-2xl bg-accent text-black font-semibold text-base hover:bg-accent-muted transition-colors"
            >
              Listen to event lineups in Berlin
            </Link>
            <p className="mt-3 text-xs text-text-tertiary">
              Uses public playlists generated once per event.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
