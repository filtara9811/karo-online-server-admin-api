import type { SupabaseClient } from "@supabase/supabase-js";
import { hasDatabase } from "../config/env.js";
import { createPgClient } from "./pg-client.js";

type AnyClient = SupabaseClient | ReturnType<typeof createPgClient>;

let pgClient: ReturnType<typeof createPgClient> | null = null;

function pg() {
  if (!pgClient) pgClient = createPgClient();
  return pgClient;
}

export function getServiceRoleClient(): AnyClient {
  if (!hasDatabase()) {
    throw new Error("DATABASE_URL missing — DigitalOcean Postgres is required");
  }
  return pg();
}

/** Privileged client when DigitalOcean Postgres is available. */
export function tryServiceRole(): AnyClient | null {
  if (hasDatabase()) return getServiceRoleClient();
  return null;
}

export function createUserClient(_accessToken: string): AnyClient {
  return getServiceRoleClient();
}

export function createAnonClient(): AnyClient {
  return getServiceRoleClient();
}
