/**
 * Spotify Web API client with automatic token refresh.
 *
 * Uses the Authorization Code flow with a stored refresh token
 * to obtain short-lived access tokens on behalf of the app-owned
 * Spotify account.
 */

import { logger } from "@/server/logging/logger";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API = "https://api.spotify.com/v1";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// ─── Token cache ──────────────────────────────────────────────────────────────

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }

  const clientId = getEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = getEnv("SPOTIFY_CLIENT_SECRET");
  const refreshToken = getEnv("SPOTIFY_REFRESH_TOKEN");

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify token refresh failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };

  logger.debug("Spotify access token refreshed");
  return cachedToken.accessToken;
}

// ─── HTTP helper with retry ───────────────────────────────────────────────────

async function spotifyFetch<T>(
  path: string,
  options: RequestInit = {},
  label: string,
): Promise<T> {
  const token = await getAccessToken();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${SPOTIFY_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (res.ok) {
      // Some endpoints return 201 with body, some 204 with no body
      if (res.status === 204) return {} as T;
      return (await res.json()) as T;
    }

    // Rate limited — retry with backoff
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
      const backoff = Math.max(retryAfter * 1000, INITIAL_BACKOFF_MS * 2 ** attempt);
      logger.warn({ label, attempt, backoff }, "Spotify 429 — backing off");
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    const body = await res.text();
    throw new Error(`Spotify ${res.status} [${label}]: ${body}`);
  }

  throw new Error(`Spotify max retries exceeded [${label}]`);
}

// ─── API methods ──────────────────────────────────────────────────────────────

export type SpotifyArtist = {
  id: string;
  name: string;
  followers: { total: number };
  popularity: number;
  genres: string[];
  images: Array<{ url: string; width: number; height: number }>;
};

export type SpotifyTrack = {
  id: string;
  name: string;
  popularity: number;
  uri: string;
  duration_ms: number;
  artists: Array<{ id: string; name: string }>;
  album: { name: string; images: Array<{ url: string }> };
};

type SearchResponse = {
  artists: {
    items: SpotifyArtist[];
    total: number;
  };
};

type TopTracksResponse = {
  tracks: SpotifyTrack[];
};

type PlaylistResponse = {
  id: string;
  external_urls: { spotify: string };
  name: string;
};

type MeResponse = {
  id: string;
  display_name: string;
};

/**
 * Search for an artist by name.
 * Returns top 5 results for fuzzy matching.
 */
export async function searchArtist(name: string): Promise<SpotifyArtist[]> {
  const q = encodeURIComponent(name);
  const data = await spotifyFetch<SearchResponse>(
    `/search?q=${q}&type=artist&limit=5`,
    {},
    `search/${name}`,
  );
  return data.artists?.items ?? [];
}

/**
 * Get an artist's top tracks for a given market.
 */
export async function getTopTracks(
  artistId: string,
  market = "DE",
): Promise<SpotifyTrack[]> {
  const data = await spotifyFetch<TopTracksResponse>(
    `/artists/${artistId}/top-tracks?market=${market}`,
    {},
    `top-tracks/${artistId}`,
  );
  return data.tracks ?? [];
}

/**
 * Get the current user's Spotify profile (used to get user_id for playlist creation).
 */
export async function getCurrentUser(): Promise<MeResponse> {
  return spotifyFetch<MeResponse>("/me", {}, "me");
}

/**
 * Create a public playlist under the authenticated user.
 */
export async function createPlaylist(params: {
  userId: string;
  name: string;
  description: string;
}): Promise<PlaylistResponse> {
  return spotifyFetch<PlaylistResponse>(
    `/users/${params.userId}/playlists`,
    {
      method: "POST",
      body: JSON.stringify({
        name: params.name,
        description: params.description,
        public: true,
      }),
    },
    `create-playlist/${params.name}`,
  );
}

/**
 * Add tracks to a playlist. Handles batching (max 100 per request).
 */
export async function addTracksToPlaylist(
  playlistId: string,
  trackUris: string[],
): Promise<void> {
  const BATCH_SIZE = 100;
  for (let i = 0; i < trackUris.length; i += BATCH_SIZE) {
    const batch = trackUris.slice(i, i + BATCH_SIZE);
    await spotifyFetch(
      `/playlists/${playlistId}/tracks`,
      {
        method: "POST",
        body: JSON.stringify({ uris: batch }),
      },
      `add-tracks/${playlistId}/batch${Math.floor(i / BATCH_SIZE)}`,
    );
  }
}
