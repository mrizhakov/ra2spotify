/**
 * RA GraphQL client.
 *
 * Listing strategy: RA exposes an `eventListings` query that accepts date-range
 * filters. We page through it day-by-day (today → +28 days) so we never miss
 * events regardless of how many are on a given night.
 *
 * Detail strategy: The listing payload does NOT return lineup or description.
 * We fetch each event individually via the `event(id)` query.
 */

const RA_GQL = "https://ra.co/graphql";

// Berlin area id confirmed via introspection (Int, not String)
export const BERLIN_AREA_ID = 34;

// ─── Types ────────────────────────────────────────────────────────────────────

export type RaListingEvent = {
  id: string;
  title: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // ISO datetime
  contentUrl: string; // e.g. "/events/12345"
  interestedCount: number;
  venue: { name: string } | null;
};

export type RaArtist = {
  name: string;
};

export type RaEventDetail = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  contentUrl: string;
  interestedCount: number;
  content: string | null; // RA calls it "content", not "description"
  images: Array<{ filename: string }>;
  venue: {
    name: string;
    address: string | null; // address is a plain string; location is GeoLocation {lat,lng}
  } | null;
  artists: RaArtist[];
  cost: string | null; // RA's cost field (StrippedHtml scalar)
  tickets: Array<{
    title: string | null;
    priceRetail: string | null; // Decimal scalar comes as string
    currency: { code: string } | null;
  }>;
};

// ─── Internal GQL helper ──────────────────────────────────────────────────────

async function gqlRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  label: string,
): Promise<T> {
  const res = await fetch(RA_GQL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Mimick a browser UA; RA blocks obvious bot UAs.
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      referer: "https://ra.co/",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(
      `RA GraphQL HTTP error [${label}]: ${res.status} ${res.statusText}`,
    );
  }

  const json = (await res.json()) as { data?: T; errors?: unknown[] };

  if (json.errors?.length) {
    throw new Error(
      `RA GraphQL errors [${label}]: ${JSON.stringify(json.errors)}`,
    );
  }

  if (!json.data) {
    throw new Error(`RA GraphQL empty data [${label}]`);
  }

  return json.data;
}

// ─── Listing fetch ────────────────────────────────────────────────────────────

const EVENT_LISTINGS_QUERY = /* graphql */ `
  query ListingsByDate($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
    eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
      data {
        id
        listingDate
        event {
          id
          title
          date
          startTime
          contentUrl
          interestedCount
          venue { name }
        }
      }
      totalResults
    }
  }
`;

type ListingPage = {
  eventListings: {
    data: Array<{ id: string; listingDate: string; event: RaListingEvent }>;
    totalResults: number;
  };
};

/**
 * Fetch all Berlin event listings for a single day.
 * Handles pagination internally.
 */
export async function fetchListingsForDay(
  dateStr: string, // "YYYY-MM-DD"
): Promise<RaListingEvent[]> {
  const PAGE_SIZE = 50;
  const results: RaListingEvent[] = [];
  let page = 1;
  let total = Infinity;

  while (results.length < total) {
    const data = await gqlRequest<ListingPage>(
      EVENT_LISTINGS_QUERY,
      {
        filters: {
          areas: { eq: BERLIN_AREA_ID },
          listingDate: { gte: dateStr, lte: dateStr },
        },
        pageSize: PAGE_SIZE,
        page,
      },
      `listings/${dateStr}/page${page}`,
    );

    const items = data.eventListings.data;
    total = data.eventListings.totalResults;

    for (const item of items) {
      if (item.event) results.push(item.event);
    }

    if (items.length < PAGE_SIZE) break; // last page
    page++;
  }

  return results;
}

/**
 * Fetch listings for a date range [fromDate, toDate] inclusive.
 * Iterates day by day to guarantee coverage.
 */
export async function fetchListingsForRange(
  fromDate: Date,
  toDate: Date,
): Promise<Map<string, RaListingEvent>> {
  const byId = new Map<string, RaListingEvent>();

  const current = new Date(fromDate);
  current.setUTCHours(0, 0, 0, 0);

  const end = new Date(toDate);
  end.setUTCHours(0, 0, 0, 0);

  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
    const events = await fetchListingsForDay(dateStr);
    for (const ev of events) {
      byId.set(ev.id, ev);
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return byId;
}

// ─── Detail fetch ─────────────────────────────────────────────────────────────

const EVENT_DETAIL_QUERY = /* graphql */ `
  query EventDetail($id: ID!) {
    event(id: $id) {
      id
      title
      date
      startTime
      contentUrl
      interestedCount
      content
      cost
      images { filename }
      venue {
        name
        address
      }
      artists { name }
      tickets {
        title
        priceRetail
        currency { code }
      }
    }
  }
`;

type EventDetailData = {
  event: RaEventDetail | null;
};

export async function fetchEventDetail(
  raEventId: string,
): Promise<RaEventDetail | null> {
  const data = await gqlRequest<EventDetailData>(
    EVENT_DETAIL_QUERY,
    { id: raEventId },
    `detail/${raEventId}`,
  );
  return data.event ?? null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive a display price string from ticket data or the cost field. */
export function extractPrice(
  detail: Pick<RaEventDetail, "tickets" | "cost">,
): string | null {
  // Prefer structured ticket data
  if (detail.tickets?.length) {
    const priced = detail.tickets
      .filter((t) => t.priceRetail != null)
      .map((t) => ({
        amount: parseFloat(t.priceRetail!),
        currency: t.currency?.code ?? "EUR",
      }))
      .filter((p) => !isNaN(p.amount));

    if (priced.length) {
      const min = Math.min(...priced.map((p) => p.amount));
      const currency = priced[0].currency;
      return `${currency} ${min.toFixed(2)}`;
    }
  }

  // Fallback to cost field (StrippedHtml scalar, e.g. "€10")
  if (detail.cost) return detail.cost;

  return null;
}

/** Source URL from a contentUrl like "/events/12345" */
export function toSourceUrl(contentUrl: string): string {
  return `https://ra.co${contentUrl}`;
}
