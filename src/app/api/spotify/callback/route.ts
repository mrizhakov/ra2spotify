import { NextRequest, NextResponse } from "next/server";

/**
 * Spotify OAuth callback — used only during setup to obtain a refresh token.
 * After exchanging the code, it displays the refresh token for you to copy.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return new NextResponse(
      `<h1>Spotify Auth Error</h1><pre>${error}</pre>`,
      { headers: { "Content-Type": "text/html" } },
    );
  }

  if (!code) {
    return new NextResponse(
      `<h1>Missing authorization code</h1>`,
      { headers: { "Content-Type": "text/html" } },
    );
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new NextResponse(
      `<h1>Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env.local</h1>`,
      { headers: { "Content-Type": "text/html" } },
    );
  }

  // Exchange code for tokens
  const redirectUri = `${req.nextUrl.origin}/api/spotify/callback`;

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return new NextResponse(
      `<h1>Token exchange failed</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`,
      { headers: { "Content-Type": "text/html" } },
    );
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>ra2spotify — Spotify Setup Complete</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 700px; margin: 60px auto; padding: 20px; background: #0a0a0a; color: #e0e0e0; }
    h1 { color: #1DB954; }
    .token-box { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin: 16px 0; word-break: break-all; font-family: monospace; font-size: 13px; }
    .label { color: #888; font-size: 12px; margin-bottom: 4px; }
    .success { color: #1DB954; font-weight: bold; }
    code { background: #222; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>✅ Spotify Authorization Successful!</h1>
  <p>Copy the refresh token below and add it to your <code>.env.local</code>:</p>
  
  <div class="label">SPOTIFY_REFRESH_TOKEN</div>
  <div class="token-box" id="refresh-token">${tokenData.refresh_token || "N/A"}</div>
  
  <p>Add this line to <code>.env.local</code>:</p>
  <div class="token-box">SPOTIFY_REFRESH_TOKEN=${tokenData.refresh_token || "MISSING"}</div>
  
  <p class="success">You can close this page after copying the token.</p>
  
  <details style="margin-top: 30px;">
    <summary style="cursor: pointer; color: #888;">Full response (debug)</summary>
    <pre style="font-size: 11px; color: #666;">${JSON.stringify({ ...tokenData, access_token: tokenData.access_token?.slice(0, 20) + "..." }, null, 2)}</pre>
  </details>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
