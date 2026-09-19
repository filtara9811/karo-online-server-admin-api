const KEY = "ko-local-session";

export type LocalSession = {
  access_token: string;
  refresh_token: string;
  email?: string;
};

export function saveLocalSession(session: LocalSession) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function getLocalSession(): LocalSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalSession;
    return parsed.access_token ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSupabaseAuthStorage() {
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith("sb-") && key.includes("auth")) localStorage.removeItem(key);
    }
  } catch {
    /* private mode */
  }
}

export function clearLocalSession() {
  localStorage.removeItem(KEY);
  clearSupabaseAuthStorage();
}
