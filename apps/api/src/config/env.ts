import "dotenv/config";

function optional(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function required(name: string, fallback?: string): string {
  const value = optional(name, fallback ?? "");
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  supabaseUrl: optional("SUPABASE_URL", "https://vnznexcljflhqethnjlh.supabase.co"),
  supabasePublishableKey: optional("SUPABASE_PUBLISHABLE_KEY"),
  supabaseServiceRoleKey: optional("SUPABASE_SERVICE_ROLE_KEY"),
  databaseUrl: optional("DATABASE_URL"),
  jwtSecret: optional("JWT_SECRET", "karo-dev-jwt-secret"),
  port: Number(optional("PORT", "4000")) || 4000,
  internalHookSecret: optional("INTERNAL_HOOK_SECRET"),
  googleMapsServerKey: optional("GOOGLE_MAPS_SERVER_KEY"),
  corsOrigin: optional("CORS_ORIGIN", "*"),
  lovableApiKey: optional("LOVABLE_API_KEY"),
  gatewayApiKey: optional("GATEWAYAPI_API_KEY"),
  publicSiteUrl: optional("PUBLIC_SITE_URL", "https://karoonline.in"),
};

export const SERVICE_ROLE_MISSING = "DATABASE_URL missing — DigitalOcean Postgres is required";

export function hasDatabase(): boolean {
  return Boolean(env.databaseUrl);
}

export function hasServiceRole(): boolean {
  return hasDatabase();
}
