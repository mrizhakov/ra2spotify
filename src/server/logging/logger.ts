import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level,
  base: {
    service: "ra2spotify",
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "access_token",
      "refresh_token",
      "token",
      "SPOTIFY_CLIENT_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
    remove: true,
  },
});
