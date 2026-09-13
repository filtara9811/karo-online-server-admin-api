import type { SupabaseClient, User } from "@supabase/supabase-js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      accessToken?: string;
      userClient?: SupabaseClient;
      authUser?: User;
      roles?: string[];
      rawBody?: string;
    }
  }
}

export {};
