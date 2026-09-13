import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

export type AdminTheme = "dark" | "light";

const KEY = "ko-admin-theme";

type Ctx = { theme: AdminTheme; setTheme: (t: AdminTheme) => void; toggle: () => void };

const ThemeCtx = createContext<Ctx>({
  theme: "dark",
  setTheme: () => undefined,
  toggle: () => undefined,
});

if (typeof document !== "undefined") {
  const saved = window.localStorage.getItem(KEY);
  document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AdminTheme>(() => {
    if (typeof window === "undefined") return "dark";
    const saved = window.localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(KEY, theme);
  }, [theme]);

  const value = useMemo<Ctx>(
    () => ({
      theme,
      setTheme: setThemeState,
      toggle: () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    }),
    [theme],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useAdminTheme() {
  return useContext(ThemeCtx);
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useAdminTheme();
  const isLight = theme === "light";
  return (
    <button
      type="button"
      onClick={toggle}
      className={`flex items-center gap-2 rounded-xl border transition ${
        compact ? "h-9 w-9 justify-center" : "w-full justify-between px-3 py-2.5"
      }`}
      style={{
        borderColor: "var(--admin-sidebar-border)",
        background: "var(--admin-signed-bg)",
        color: "var(--admin-ink)",
      }}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      {isLight ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      {!compact && (
        <span className="text-[10px] uppercase tracking-[0.22em] font-bold">
          {isLight ? "Dark mode" : "Light mode"}
        </span>
      )}
    </button>
  );
}
