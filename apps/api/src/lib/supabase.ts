import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasServiceRole, SERVICE_ROLE_MISSING } from "../config/env.js";

const AUTH_OPTS = {
  persistSession: false,
  autoRefreshToken: false,
  storage: undefined,
} as const;

let adminClient: SupabaseClient | null = null;

export function getServiceRoleClient(): SupabaseClient {
  if (!hasServiceRole()) {
    throw new Error(SERVICE_ROLE_MISSING);
  }
  if (!adminClient) {
    adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: AUTH_OPTS,
    });
  }
  return adminClient;
}

/** Privileged client when the service role key exists; otherwise null. */
export function tryServiceRole(): SupabaseClient | null {
  return hasServiceRole() ? getServiceRoleClient() : null;
}

export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: AUTH_OPTS,
  });
}

export function createAnonClient(): SupabaseClient {
  const key = env.supabasePublishableKey;
  return createClient(env.supabaseUrl, key, {
    auth: AUTH_OPTS,
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}
