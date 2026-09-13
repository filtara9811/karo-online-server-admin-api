import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, GripHorizontal, Minus, Plus, RotateCcw, Smartphone, X, ZoomIn, ZoomOut } from "lucide-react";
import { apiFetch, asList, str } from "@/lib/api";

type Device = { id: string; label: string; src: string; icon?: string };

function siteBase() {
  const env = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.replace(/\/$/, "");
  if (env) return env;
  if (typeof window === "undefined") return "";
  if (window.location.port === "5173") return "http://localhost:4000";
  return window.location.origin;
}

const LEGACY_PATHS: Record<string, string> = {
  "/register": "/",
  "/quick": "/",
  "/home": "/",
  "/welcome": "/",
  "/vendor/dashboard": "/s/demo",
  "/vendor": "/s/demo",
};

const LABEL_PATH: Record<string, string> = {
  app: "/",
  home: "/",
  quick: "/",
  "digital shop": "/s/demo",
  shop: "/s/demo",
  vendor: "/s/demo",
  "one qr": "/q/demo",
  qr: "/q/demo",
  referral: "/r/demo",
  card: "/c/demo",
};

function canFrame(url: string) {
  try {
    const parsed = new URL(url, siteBase() || "http://localhost:4000");
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname.endsWith("karoonline.in")
    );
  } catch {
    return false;
  }
}

function normalizeSrc(raw: string, label = "") {
  const fallbackPath = LABEL_PATH[label.trim().toLowerCase()] ?? "/";
  let value = (raw || "").trim();
  if (!value) return withEmbed(`${siteBase()}${fallbackPath}`);
  value = value.replace(/^hohttps?:\/\//i, "https://");
  value = value.replace(/^https?:\/\/https?:\/\//i, "https://");

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!canFrame(url.toString())) return `${siteBase()}${fallbackPath}`;
      const mapped = LEGACY_PATHS[url.pathname] ?? url.pathname;
      return withEmbed(`${siteBase()}${mapped}${url.search}`);
    } catch {
      return withEmbed(`${siteBase()}${fallbackPath}`);
    }
  }

  const path = value.startsWith("/") ? value : `/${value}`;
  try {
    const url = new URL(path, "http://local.invalid");
    const mapped = LEGACY_PATHS[url.pathname] ?? url.pathname;
    return withEmbed(`${siteBase()}${mapped}${url.search}`);
  } catch {
    return withEmbed(`${siteBase()}${fallbackPath}`);
  }
}

function withEmbed(url: string) {
  try {
    const parsed = new URL(url, siteBase() || "http://localhost:4000");
    if (!parsed.searchParams.has("embed")) parsed.searchParams.set("embed", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

function defaultDevices(): Device[] {
  return [
    { id: "app", label: "App", src: normalizeSrc("/", "App"), icon: "📱" },
    { id: "shop", label: "Digital Shop", src: normalizeSrc("/s/demo", "Digital Shop"), icon: "🏪" },
    { id: "qr", label: "One QR", src: normalizeSrc("/q/demo", "One QR"), icon: "🔳" },
    { id: "ref", label: "Referral", src: normalizeSrc("/r/demo", "Referral"), icon: "🎁" },
  ];
}

const FRAME_W = 300;
const FRAME_H = 620;
const LS_VISIBLE = "ko-admin-devices-visible";
const LS_STATE = (id: string) => `ko-admin-device-${id}`;

type FrameState = { x: number; y: number; zoom: number; minimized: boolean };

function vw() {
  return window.innerWidth;
}
function vh() {
  return window.innerHeight;
}

function PhoneFrame({ device, indexOffset, onClose }: { device: Device; indexOffset: number; onClose: () => void }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ dx: 0, dy: 0, active: false });
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<FrameState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_STATE(device.id)) || "null");
      if (saved && typeof saved.x === "number") return saved;
    } catch {
      /* ignore */
    }
    const scale = Math.min((window.innerWidth * 0.4) / FRAME_W, (window.innerHeight * 0.8) / FRAME_H, 1);
    return {
      x: Math.max(16, window.innerWidth - FRAME_W * scale - 36 - indexOffset * 28),
      y: 88 + indexOffset * 24,
      zoom: 1,
      minimized: false,
    };
  });

  const scale = Math.max(0.45, Math.min(state.zoom, 1.3));
  const boxW = state.minimized ? 56 : FRAME_W * scale;
  const boxH = state.minimized ? 56 : FRAME_H * scale;

  const clamp = useCallback((x: number, y: number, minimized = state.minimized) => {
    const W = minimized ? 56 : FRAME_W * Math.max(0.45, Math.min(state.zoom, 1.3));
    const H = minimized ? 56 : FRAME_H * Math.max(0.45, Math.min(state.zoom, 1.3));
    return {
      x: Math.min(Math.max(8, x), Math.max(8, vw() - W - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, vh() - H - 8)),
    };
  }, [state.minimized, state.zoom]);

  const persist = useCallback((next: Partial<FrameState>) => {
    setState((s) => {
      const merged = { ...s, ...next };
      const c = clamp(merged.x, merged.y, merged.minimized);
      const out = { ...merged, x: c.x, y: c.y };
      try {
        localStorage.setItem(LS_STATE(device.id), JSON.stringify(out));
      } catch {
        /* ignore */
      }
      return out;
    });
  }, [clamp, device.id]);

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.preventDefault();
    e.stopPropagation();
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top, active: true };
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      if (!drag.current.active) return;
      ev.preventDefault();
      const next = clamp(ev.clientX - drag.current.dx, ev.clientY - drag.current.dy);
      setState((s) => ({ ...s, x: next.x, y: next.y }));
    };
    const onUp = () => {
      drag.current.active = false;
      setDragging(false);
      persist({});
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  if (state.minimized) {
    return (
      <button
        ref={frameRef as React.RefObject<HTMLButtonElement>}
        type="button"
        className="fixed z-[999] h-14 w-14 rounded-2xl grid place-items-center text-[#1a1208] cursor-grab active:cursor-grabbing"
        style={{
          left: state.x,
          top: state.y,
          touchAction: "none",
          background: "linear-gradient(180deg,#fff3c8,#d4af37 60%,#8b6508)",
        }}
        onPointerDown={startDrag}
        onDoubleClick={() => persist({ minimized: false })}
        title={`${device.label} — drag or double-click to open`}
      >
        {device.icon ? <span>{device.icon}</span> : <Smartphone className="h-5 w-5" />}
      </button>
    );
  }

  return (
    <div
      ref={frameRef}
      className={`fixed z-[999] select-none ${dragging ? "cursor-grabbing" : ""}`}
      style={{ left: state.x, top: state.y, width: boxW, height: boxH, touchAction: "none" }}
    >
      <div style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <div
          className="relative h-full w-full rounded-[40px] p-2.5 cursor-grab active:cursor-grabbing"
          style={{
            background: "linear-gradient(160deg,#1a1a1a,#0a0a0a)",
            border: "2px solid #2a2a2a",
            touchAction: "none",
          }}
          onPointerDown={startDrag}
        >
          <div
            className="absolute -top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 px-4 py-1.5 rounded-full bg-[#1a1a1a] border border-[#d4af37]/40 cursor-grab active:cursor-grabbing"
            style={{ touchAction: "none" }}
            onPointerDown={startDrag}
          >
            <GripHorizontal className="h-3.5 w-3.5 text-[#d4af37]" />
            <span className="text-[10px] uppercase tracking-widest text-white/70">{device.label}</span>
          </div>
          <div className="absolute -top-3 right-2 z-30 flex gap-1" data-no-drag>
            <button type="button" className="h-6 w-6 rounded-full grid place-items-center bg-[#1a1a1a] border border-white/15 text-white/80" onClick={() => persist({ zoom: Math.max(0.55, state.zoom - 0.1) })}>
              <ZoomOut className="h-3 w-3" />
            </button>
            <button type="button" className="h-6 w-6 rounded-full grid place-items-center bg-[#1a1a1a] border border-white/15 text-white/80" onClick={() => persist({ zoom: Math.min(1.3, state.zoom + 0.1) })}>
              <ZoomIn className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="h-6 w-6 rounded-full grid place-items-center bg-[#1a1a1a] border border-white/15 text-white/80"
              onClick={() => {
                const f = frameRef.current?.querySelector("iframe");
                if (f) f.src = f.src;
              }}
            >
              <RotateCcw className="h-3 w-3" />
            </button>
            <a href={device.src} target="_blank" rel="noreferrer" className="h-6 w-6 rounded-full grid place-items-center bg-[#1a1a1a] border border-white/15 text-white/80">
              <ExternalLink className="h-3 w-3" />
            </a>
            <button type="button" className="h-6 w-6 rounded-full grid place-items-center bg-[#1a1a1a] border border-white/15 text-white/80" onClick={() => persist({ minimized: true })}>
              <Minus className="h-3 w-3" />
            </button>
            <button type="button" className="h-6 w-6 rounded-full grid place-items-center bg-[#1a1a1a] border border-white/15 text-white/80" onClick={onClose}>
              <X className="h-3 w-3" />
            </button>
          </div>
          <div
            className="absolute left-0 right-0 top-8 h-10 z-20 cursor-grab active:cursor-grabbing"
            style={{ touchAction: "none" }}
            onPointerDown={startDrag}
            title="Drag phone"
          />
          <div className="relative h-full w-full rounded-[32px] overflow-hidden bg-white">
            <div className="absolute top-1.5 left-1/2 -translate-x-1/2 z-20 h-4 w-20 rounded-full bg-black/90 pointer-events-none" />
            <iframe
              src={device.src}
              title={`${device.label} preview`}
              className="absolute inset-0 h-full w-full border-0"
              style={{ pointerEvents: dragging ? "none" : "auto" }}
              allow="geolocation; clipboard-write"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function FloatingPhoneMockup() {
  const [devices, setDevices] = useState<Device[]>(() => defaultDevices());
  const [visible, setVisible] = useState<Record<string, boolean>>({ app: true });
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = asList(await apiFetch("/v1/admin/table/web_virtual_devices"));
      const defaults = defaultDevices();
      const extras = rows
        .filter((r) => r.is_active !== false)
        .map((d) => ({
          id: `db-${str(d.id)}`,
          label: str(d.label, "Device"),
          src: normalizeSrc(str(d.url || d.src, "/"), str(d.label, "Device")),
          icon: d.icon ? str(d.icon) : "📱",
        }))
        .filter((d) => canFrame(d.src) && !defaults.some((base) => base.label.toLowerCase() === d.label.toLowerCase()));
      const next = [...defaults, ...extras];
      setDevices(next);
      setVisible((current) => {
        const allowed = new Set(next.map((d) => d.id));
        const cleaned = Object.fromEntries(Object.entries(current).filter(([id]) => allowed.has(id)));
        if (!Object.values(cleaned).some(Boolean) && next[0]) cleaned[next[0].id] = true;
        try {
          localStorage.setItem(LS_VISIBLE, JSON.stringify(cleaned));
        } catch {
          /* ignore */
        }
        return cleaned;
      });
    } catch {
      setDevices(defaultDevices());
    }
  }, []);

  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LS_VISIBLE) || "null");
      if (v && typeof v === "object") setVisible(v);
    } catch {
      /* ignore */
    }
    void load();
  }, [load]);

  const toggle = (id: string) => {
    setVisible((v) => {
      const next = { ...v, [id]: !v[id] };
      try {
        localStorage.setItem(LS_VISIBLE, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const active = devices.filter((d) => visible[d.id]);

  return (
    <>
      {active.map((d, i) => (
        <PhoneFrame key={d.id} device={d} indexOffset={i} onClose={() => toggle(d.id)} />
      ))}
      <div className="fixed bottom-4 right-4 z-[1000] flex flex-col items-end gap-2">
        {menuOpen && (
          <div className="w-64 rounded-2xl border border-[#d4af37]/30 bg-[#0a0a0a]/95 p-2">
            <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-[#d4af37]/80">Virtual devices</div>
            {devices.map((d) => {
              const on = !!visible[d.id];
              return (
                <button key={d.id} type="button" onClick={() => toggle(d.id)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 text-left">
                  <span className="h-7 w-7 rounded-lg grid place-items-center bg-white/5 text-sm">{d.icon || "📱"}</span>
                  <span className="flex-1 text-sm text-white/90 truncate">{d.label}</span>
                  <span className={`h-5 w-9 rounded-full relative ${on ? "bg-[#d4af37]" : "bg-white/15"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ${on ? "left-[18px]" : "left-0.5"}`} />
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            void load();
            setMenuOpen((o) => !o);
          }}
          className="h-12 w-12 rounded-full grid place-items-center text-[#1a1208]"
          style={{ background: "linear-gradient(180deg,#fff3c8,#d4af37 60%,#8b6508)" }}
          title="Virtual devices"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        </button>
      </div>
    </>
  );
}
