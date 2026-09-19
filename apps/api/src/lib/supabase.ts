import { hasDatabase } from "../config/env.js";
import { createPgClient, type DbClient } from "./pg-client.js";

export type { AuthUser, DbClient, QueryBuilder, QueryResult } from "./pg-client.js";

let pgClient: DbClient | null = null;

function pg() {
  if (!pgClient) pgClient = createPgClient();
  return pgClient;
}

export function getServiceRoleClient(): DbClient {
  if (!hasDatabase()) {
    throw new Error("DATABASE_URL missing — DigitalOcean Postgres is required");
  }
  return pg();
}

/** Privileged client when DigitalOcean Postgres is available. */
export function tryServiceRole(): DbClient | null {
  if (hasDatabase()) return getServiceRoleClient();
  return null;
}

export function createUserClient(_accessToken: string): DbClient {
  return getServiceRoleClient();
}

export function createAnonClient(): DbClient {
  return getServiceRoleClient();
}
