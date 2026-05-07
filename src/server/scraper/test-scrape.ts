/**
 * Standalone scraper test — runs the RA listing + detail pipeline
 * WITHOUT Supabase. Dumps results to scrape_test_output.json.
 *
 * Usage:  npx tsx src/server/scraper/test-scrape.ts
 */

const RA_GQL = "https://ra.co/graphql";
const BERLIN_AREA_ID = 34;
const PAGE_SIZE = 50;
const DETAIL_DELAY_MS = 250;
const DAYS_AHEAD = 3; // Only scrape 3 days for the test

// ─── GQL helper ───────────────────────────────────────────────────────────────

async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  label: string,
): Promise<T> {
  const res = await fetch(RA_GQL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      referer: "https://ra.co/",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`RA HTTP ${res.status} [${label}]`);
  }

  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors?.length) {
    throw new Error(`GQL errors [${label}]: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data) throw new Error(`Empty data [${label}]`);
  return json.data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Listing query ────────────────────────────────────────────────────────────

const LISTING_Q = `query($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
  eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
    data {
      id
      listingDate
      event { id title date startTime contentUrl interestedCount venue { name } }
    }
    totalResults
  }
}`;

type ListingEvent = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  contentUrl: string;
  interestedCount: number;
  venue: { name: string } | null;
};

async function fetchListingsForDay(dateStr: string): Promise<ListingEvent[]> {
  const results: ListingEvent[] = [];
  let page = 1;
  let total = Infinity;

  while (results.length < total) {
    const data = await gql<{
      eventListings: {
        data: Array<{ event: ListingEvent }>;
        totalResults: number;
      };
    }>(
      LISTING_Q,
      {
        filters: {
          areas: { eq: BERLIN_AREA_ID },
          listingDate: { gte: dateStr, lte: dateStr },
        },
        pageSize: PAGE_SIZE,
        page,
      },
      `list/${dateStr}/p${page}`,
    );

    total = data.eventListings.totalResults;
    for (const item of data.eventListings.data) {
      if (item.event) results.push(item.event);
    }
    if (data.eventListings.data.length < PAGE_SIZE) break;
    page++;
  }

  return results;
}

// ─── Detail query ─────────────────────────────────────────────────────────────

const DETAIL_Q = `query($id: ID!) {
  event(id: $id) {
    id title date startTime contentUrl interestedCount
    content cost
    images { filename }
    venue { name address }
    artists { name }
    tickets { title priceRetail currency { code } }
  }
}`;

type EventDetail = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  contentUrl: string;
  interestedCount: number;
  content: string | null;
  cost: string | null;
  venue: { name: string; address: string | null } | null;
  artists: Array<{ name: string }>;
  tickets: Array<{
    title: string | null;
    priceRetail: string | null;
    currency: { code: string } | null;
  }>;
};

async function fetchDetail(id: string): Promise<EventDetail | null> {
  const data = await gql<{ event: EventDetail | null }>(
    DETAIL_Q,
    { id },
    `detail/${id}`,
  );
  return data.event ?? null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const fs = await import("fs");
  const start = Date.now();

  console.log(`\n🎧 ra2spotify scraper test`);
  console.log(`   Scraping Berlin events for the next ${DAYS_AHEAD} days\n`);

  // 1. Fetch listings
  const allEvents = new Map<string, ListingEvent>();
  const today = new Date();

  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    process.stdout.write(`  📅 ${dateStr} ... `);
    const events = await fetchListingsForDay(dateStr);
    for (const e of events) allEvents.set(e.id, e);
    console.log(`${events.length} events`);
  }

  console.log(`\n  Total unique events: ${allEvents.size}`);

  // 2. Fetch details for first 10 events
  const ids = Array.from(allEvents.keys()).slice(0, 10);
  console.log(`\n  Fetching detail for ${ids.length} events...\n`);

  const details: EventDetail[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const listing = allEvents.get(id)!;
    process.stdout.write(`  [${i + 1}/${ids.length}] ${listing.title?.slice(0, 50)}... `);
    try {
      const detail = await fetchDetail(id);
      if (detail) {
        details.push(detail);
        const artistNames = detail.artists?.map((a) => a.name).join(", ") || "(no artists)";
        console.log(`✅ ${detail.artists?.length ?? 0} artists: ${artistNames.slice(0, 60)}`);
      } else {
        console.log(`⚠️ null`);
      }
    } catch (err) {
      console.log(`❌ ${err instanceof Error ? err.message : err}`);
    }
    if (i < ids.length - 1) await sleep(DETAIL_DELAY_MS);
  }

  // 3. Write output
  const output = {
    scraped_at: new Date().toISOString(),
    days_scraped: DAYS_AHEAD,
    total_listings: allEvents.size,
    details_fetched: details.length,
    sample_events: details.map((d) => ({
      id: d.id,
      title: d.title,
      date: d.date,
      start_time: d.startTime,
      venue: d.venue?.name ?? null,
      address: d.venue?.address ?? null,
      artists: d.artists?.map((a) => a.name) ?? [],
      interested: d.interestedCount,
      cost: d.cost,
      content_preview: d.content?.slice(0, 300) ?? null,
      url: `https://ra.co${d.contentUrl}`,
    })),
  };

  const outPath = "scrape_test_output.json";
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n  ✅ Done in ${elapsed}s`);
  console.log(`  📄 Output saved to ${outPath}`);
  console.log(`\n  Sample event:`);
  if (details[0]) {
    const s = details[0];
    console.log(`    Title:    ${s.title}`);
    console.log(`    Venue:    ${s.venue?.name ?? "TBD"}`);
    console.log(`    Address:  ${s.venue?.address ?? "N/A"}`);
    console.log(`    Artists:  ${s.artists?.map((a) => a.name).join(", ") ?? "N/A"}`);
    console.log(`    Cost:     ${s.cost ?? "N/A"}`);
    console.log(`    URL:      https://ra.co${s.contentUrl}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("💥 FATAL:", err);
  process.exit(1);
});
