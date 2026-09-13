import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (key?.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
        headers.delete("Authorization");
      }
      if (key) headers.set("apikey", key);
      return fetch(input, { ...init, headers });
    },
  },
});
