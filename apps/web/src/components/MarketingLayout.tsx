import { Link, NavLink, Outlet } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { Menu, X, Download } from "lucide-react";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About" },
  { to: "/features", label: "Features" },
  { to: "/for-vendors", label: "For Vendors" },
  { to: "/for-customers", label: "For Customers" },
  { to: "/pricing", label: "Pricing" },
  { to: "/blog", label: "Blog" },
  { to: "/contact", label: "Contact" },
] as const;

export function MarketingLayout({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [children]);

  return (
    <div className="min-h-screen text-white" style={{ background: "#0a0a0a" }}>
      <header className="sticky top-0 z-40 ko-glass">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="h-9 w-9 rounded-xl grid place-items-center font-bold text-[#1a1208] ko-gold-bar">K</span>
            <span className="font-display text-xl tracking-wide">
              <span className="ko-gold-text">Karo</span>
              <span className="text-white/90">Online</span>
            </span>
          </Link>
          <nav className="hidden lg:flex items-center gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  `px-3 py-2 text-sm rounded-lg transition-colors ${isActive ? "text-white bg-white/5" : "text-white/70 hover:text-white hover:bg-white/5"}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/download" className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold ko-gold-bar">
              <Download className="h-4 w-4" /> App
            </Link>
            <button className="lg:hidden p-2 text-white/80" onClick={() => setOpen((v) => !v)} aria-label="Menu">
              {open ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {open && (
          <div className="lg:hidden px-4 pb-4 grid gap-1">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className="px-3 py-2 rounded-lg text-white/80 hover:bg-white/5" onClick={() => setOpen(false)}>
                {n.label}
              </NavLink>
            ))}
          </div>
        )}
      </header>
      {children ?? <Outlet />}
      <footer className="border-t border-white/10 mt-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid gap-6 md:grid-cols-3 text-sm text-white/55">
          <div>
            <div className="font-display text-xl text-white mb-2">Karo Online</div>
            Powered by Filipra Private Limited — India's hyperlocal marketplace.
          </div>
          <div className="grid gap-2">
            <Link to="/privacy-policy" className="hover:text-[#f5d97a]">Privacy</Link>
            <Link to="/terms-and-conditions" className="hover:text-[#f5d97a]">Terms</Link>
            <Link to="/shipping-policy" className="hover:text-[#f5d97a]">Shipping</Link>
            <Link to="/refund-policy" className="hover:text-[#f5d97a]">Refunds</Link>
          </div>
          <div>
            4988, First Floor, Gali Maliyan Chowk, Ahata Kidara, Sadar Bazar, Delhi
            <div className="mt-2">
              <a href="mailto:Ashu@filipra.com" className="text-[#f5d97a]">Ashu@filipra.com</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
