/**
 * Interactive script to obtain a Spotify refresh token.
 *
 * Prerequisites:
 *   1. Create a Spotify app at https://developer.spotify.com/dashboard
 *   2. Set Redirect URI to: http://localhost:3456/api/spotify/callback
 *   3. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env.local
 *   4. Start the dev server: npm run dev -- --port 3456
 *
 * Usage:
 *   npx tsx scripts/get-spotify-token.ts
 */

import * as fs from "fs";
import * as path from "path";

function loadEnvFile(): Record<string, string> {
  const envPath = path.join(process.cwd(), ".env.local");
  const vars: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return vars;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return vars;
}

const env = loadEnvFile();
const clientId = env.SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID;

if (!clientId) {
  console.error(`
❌ SPOTIFY_CLIENT_ID not found in .env.local

To set up Spotify:
  1. Go to https://developer.spotify.com/dashboard
  2. Create an app (name: "ra2spotify", redirect URI: http://localhost:3456/api/spotify/callback)
  3. Copy Client ID and Client Secret
  4. Add to .env.local:
     SPOTIFY_CLIENT_ID=your_client_id
     SPOTIFY_CLIENT_SECRET=your_client_secret
`);
  process.exit(1);
}

const redirectUri = "http://127.0.0.1:3456/api/spotify/callback";

const scopes = [
  "playlist-modify-public",
  "playlist-modify-private",
  "user-read-private",
].join(" ");

const authUrl = new URL("https://accounts.spotify.com/authorize");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("scope", scopes);
authUrl.searchParams.set("show_dialog", "true");

console.log(`
🎧 ra2spotify — Spotify Setup

Steps:
  1. Make sure the dev server is running: npm run dev -- --port 3456
  2. Open the URL below in your browser
  3. Authorize the app with your Spotify account
  4. Copy the refresh token from the callback page
  5. Add SPOTIFY_REFRESH_TOKEN=... to .env.local

📎 Open this URL:

${authUrl.toString()}
`);

// Try to open browser automatically
import("child_process").then(({ exec }) => {
  exec(`open "${authUrl.toString()}"`, (err) => {
    if (err) {
      console.log("(Could not open browser automatically — copy the URL above)");
    } else {
      console.log("🌐 Browser opened! Authorize the app...\n");
    }
  });
});
