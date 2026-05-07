/**
 * Quick setup: applies the Phase 1 migration to a Supabase project,
 * then runs a test scrape of 1 day of Berlin events.
 *
 * Usage:
 *   1. Create a Supabase project at https://supabase.com/dashboard
 *   2. Copy the project URL and service_role key
 *   3. Run: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/setup-and-test.ts
 *
 * Or if you already have .env.local:
 *   npx tsx scripts/setup-and-test.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ─── Load .env.local if it exists ─────────────────────────────────────────────

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(`
❌ Missing Supabase credentials.

Either:
  1. Create .env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
  2. Or pass them as env vars:
     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/setup-and-test.ts

To get these values:
  1. Go to https://supabase.com/dashboard → New Project
  2. After creation → Settings → API
  3. Copy "Project URL" and "service_role" key (not anon key)
`);
  process.exit(1);
}

console.log(`\n🔧 ra2spotify — Setup & Test`);
console.log(`   Supabase URL: ${SUPABASE_URL}\n`);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Step 1: Apply migration ──────────────────────────────────────────────────

async function applyMigration() {
  console.log("1️⃣  Applying database migration...");

  const migrationPath = path.join(
    process.cwd(),
    "supabase/migrations/20260507000100_phase1_init.sql",
  );
  const sql = fs.readFileSync(migrationPath, "utf-8");

  // Split into individual statements (rough but works for our migration)
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  let applied = 0;
  let errors = 0;

  for (const stmt of statements) {
    const { error } = await supabase.rpc("exec_sql", { sql_text: stmt + ";" }).single();
    if (error) {
      // Try direct query as fallback
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ sql_text: stmt + ";" }),
      });
      if (!res.ok) {
        // It's ok if tables already exist
        const body = await res.text();
        if (body.includes("already exists") || body.includes("duplicate")) {
          applied++;
        } else {
          console.log(`   ⚠️  Statement error: ${body.slice(0, 200)}`);
          errors++;
        }
      } else {
        applied++;
      }
    } else {
      applied++;
    }
  }

  console.log(`   ✅ Migration: ${applied} statements applied, ${errors} errors\n`);
}

// ─── Step 2: Test connection ──────────────────────────────────────────────────

async function testConnection() {
  console.log("2️⃣  Testing Supabase connection...");

  // Try to query events table
  const { data, error } = await supabase
    .from("events")
    .select("id")
    .limit(1);

  if (error) {
    console.log(`   ❌ Cannot query events table: ${error.message}`);
    console.log(`   Hint: You may need to apply the migration manually.`);
    console.log(`   Run this SQL in Supabase SQL Editor:`);
    console.log(`   → supabase/migrations/20260507000100_phase1_init.sql\n`);
    return false;
  }

  console.log(`   ✅ Connected! Events table has ${data?.length ?? 0} rows.\n`);
  return true;
}

// ─── Step 3: Insert a test event from RA ──────────────────────────────────────

async function testScrapeAndInsert() {
  console.log("3️⃣  Scraping 1 event from RA and inserting into Supabase...\n");

  // Fetch one listing
  const listingQuery = `query($filters: FilterInputDtoInput, $pageSize: Int) {
    eventListings(filters: $filters, pageSize: $pageSize, page: 1) {
      data { event { id title date startTime contentUrl interestedCount venue { name } } }
      totalResults
    }
  }`;

  const today = new Date().toISOString().slice(0, 10);
  const listRes = await fetch("https://ra.co/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      referer: "https://ra.co/",
    },
    body: JSON.stringify({
      query: listingQuery,
      variables: {
        filters: { areas: { eq: 34 }, listingDate: { gte: today, lte: today } },
        pageSize: 1,
      },
    }),
  });

  const listJson = await listRes.json();
  if (listJson.errors) {
    console.log(`   ❌ RA listing failed: ${JSON.stringify(listJson.errors)}`);
    return;
  }

  const firstEvent = listJson.data.eventListings.data[0]?.event;
  if (!firstEvent) {
    console.log("   ⚠️ No events found for today");
    return;
  }

  console.log(`   Found: [${firstEvent.id}] ${firstEvent.title}`);

  // Fetch detail
  const detailQuery = `query($id: ID!) {
    event(id: $id) {
      id title date startTime contentUrl interestedCount
      content cost
      venue { name address }
      artists { name }
      tickets { title priceRetail currency { code } }
    }
  }`;

  const detRes = await fetch("https://ra.co/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      referer: "https://ra.co/",
    },
    body: JSON.stringify({ query: detailQuery, variables: { id: firstEvent.id } }),
  });

  const detJson = await detRes.json();
  if (detJson.errors) {
    console.log(`   ❌ RA detail failed: ${JSON.stringify(detJson.errors)}`);
    return;
  }

  const detail = detJson.data.event;
  if (!detail) {
    console.log("   ⚠️ Event detail is null");
    return;
  }

  const artists = detail.artists?.map((a: { name: string }) => a.name) ?? [];
  console.log(`   Artists: ${artists.join(", ") || "(none)"}`);
  console.log(`   Venue: ${detail.venue?.name ?? "TBD"}`);

  // Upsert into Supabase
  const { data: inserted, error: insertErr } = await supabase
    .from("events")
    .upsert(
      {
        source: "ra",
        source_url: `https://ra.co${detail.contentUrl}`,
        ra_event_id: detail.id,
        title: detail.title,
        description: detail.content,
        date_time: detail.startTime,
        venue: detail.venue?.name ?? null,
        location: detail.venue?.address ?? null,
        price: detail.cost ?? null,
        interested_count: detail.interestedCount,
        lineup_json: artists,
        content_hash: "test",
        last_scraped_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        status: "unprocessed",
      },
      { onConflict: "ra_event_id" },
    )
    .select("id")
    .single();

  if (insertErr) {
    console.log(`   ❌ Insert failed: ${insertErr.message}`);
    return;
  }

  console.log(`   ✅ Inserted! Supabase ID: ${inserted?.id}\n`);

  // Verify read-back
  const { data: readBack } = await supabase
    .from("events")
    .select("id, title, venue, lineup_json")
    .eq("id", inserted?.id)
    .single();

  if (readBack) {
    console.log(`   📖 Read-back verified:`);
    console.log(`      Title: ${readBack.title}`);
    console.log(`      Venue: ${readBack.venue}`);
    console.log(`      Lineup: ${JSON.stringify(readBack.lineup_json)}\n`);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  const connected = await testConnection();

  if (!connected) {
    console.log("   Trying to apply migration first...\n");
    await applyMigration();
    const retry = await testConnection();
    if (!retry) {
      console.log("❌ Still can't connect. Please apply the migration manually.\n");
      process.exit(1);
    }
  }

  await testScrapeAndInsert();

  console.log("🎉 Setup complete! You can now:");
  console.log("   • Run the full scraper: curl 'http://localhost:3000/api/cron/scrape-ra?secret=YOUR_SECRET'");
  console.log("   • Start the app: npm run dev");
  console.log("   • Browse events: http://localhost:3000/events\n");
}

main().catch((err) => {
  console.error("💥 FATAL:", err);
  process.exit(1);
});
