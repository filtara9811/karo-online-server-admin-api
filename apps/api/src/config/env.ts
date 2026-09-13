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
  supabaseUrl: required("SUPABASE_URL", "https://vnznexcljflhqethnjlh.supabase.co"),
  supabasePublishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
  supabaseServiceRoleKey: optional("SUPABASE_SERVICE_ROLE_KEY"),
  port: Number(optional("PORT", "4000")) || 4000,
  internalHookSecret: optional("INTERNAL_HOOK_SECRET"),
  googleMapsServerKey: optional("GOOGLE_MAPS_SERVER_KEY"),
  corsOrigin: optional("CORS_ORIGIN", "*"),
  lovableApiKey: optional("LOVABLE_API_KEY"),
  gatewayApiKey: optional("GATEWAYAPI_API_KEY"),
  publicSiteUrl: optional("PUBLIC_SITE_URL", "https://karoonline.in"),
};

export const SERVICE_ROLE_MISSING = "SUPABASE_SERVICE_ROLE_KEY missing";

export function hasServiceRole(): boolean {
  return Boolean(env.supabaseServiceRoleKey);
}
