import type { AuthUser, DbClient } from "../lib/pg-client.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      accessToken?: string;
      userClient?: DbClient;
      authUser?: AuthUser;
      roles?: string[];
      rawBody?: string;
    }
  }
}

export {};
