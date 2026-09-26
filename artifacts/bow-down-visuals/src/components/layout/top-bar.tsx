import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Zap, FolderOpen, LogOut, Menu, X, User, Plus, Loader2, ChevronDown, HelpCircle, Wand2, SlidersHorizontal, Settings,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";

const IS_DEV = import.meta.env.DEV;

const NAV_LINKS = [
  { label: "Dashboard",        href: "/dashboard" },
  { label: "Start from Scratch", href: "/song-and-video" },
  { label: "MV",  href: "/make-video" },
  { label: "Promo Clips",       href: "/promo-clip" },
  { label: "Artist Profiles",   href: "/artist-vault" },
  { label: "Pricing",           href: "/pricing" },
];

interface TopBarProps {
  /** Reports the header's current rendered height (px) so other fixed/floating UI
   *  (e.g. the master preview player) can avoid rendering underneath it. */
  onHeightChange?: (height: number) => void;
}

/** Compact Simple / Advanced mode switch shared by the desktop and mobile nav. */
function ModeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useUserMode();
  return (
    <div
      className={`inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.03] p-0.5 ${compact ? "w-full" : ""}`}
      role="tablist"
      aria-label="Simple or Advanced mode"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "simple"}
        onClick={() => setMode("simple")}
        className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${compact ? "flex-1" : ""} ${
          mode === "simple" ? "bg-primary text-black" : "text-white/45 hover:text-white"
        }`}
        title="Simple mode — one-click AI-driven creation"
      >
        <Wand2 className="h-3.5 w-3.5" /> Simple
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "advanced"}
        onClick={() => setMode("advanced")}
        className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${compact ? "flex-1" : ""} ${
          mode === "advanced" ? "bg-primary text-black" : "text-white/45 hover:text-white"
        }`}
        title="Advanced mode — full manual controls"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" /> Advanced
      </button>
    </div>
  );
}

export function TopBar({ onHeightChange }: TopBarProps = {}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const [addingCredits, setAddingCredits] = useState(false);
  const { user, profile, signOut, getAccessToken, refreshProfile } = useAuth();
  const headerRef = useRef<HTMLElement | null>(null);
  /* Same cursor-tilt + gold-glow treatment as the header brand mark. */
  const logoTilt = useTiltOnHover<HTMLAnchorElement>({ maxDeg: 8, maxShift: 6 });

  /* ── Report the header's rendered height whenever it changes (e.g. the mobile
   *    menu opening/closing grows the header), mirroring TimelineDock's onHeightChange. ── */
  useEffect(() => {
    const el = headerRef.current;
    if (!el || !onHeightChange) return;
    const report = () => onHeightChange(el.getBoundingClientRect().height);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange, menuOpen]);

  async function handleSignOut() {
    setUserMenuOpen(false);
    await signOut();
    setLocation("/");
  }

  async function handleAddTestCredits() {
    setAddingCredits(true);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/dev/add-credits", { method: "POST", headers });
      if (res.ok) await refreshProfile();
    } finally {
      setAddingCredits(false);
    }
  }

  const displayName = profile?.display_name ?? user?.email?.split("@")[0] ?? "Account";

  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link href="/" ref={logoTilt} className="cursor-pointer shrink-0 inline-block rounded-lg">
          <img src={`${import.meta.env.BASE_URL}logo-static.png`} alt="Bow Down Visuals" className="h-16 w-auto" />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-0.5">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                location === link.href
                  ? "text-white bg-white/[0.07]"
                  : "text-white/45 hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">

          {/* Simple / Advanced mode toggle */}
          {user && (
            <div className="hidden md:block">
              <ModeToggle />
            </div>
          )}

          {/* Theme song mini-player */}

          {/* Dev credits button */}
          {IS_DEV && user && (
            <button
              onClick={handleAddTestCredits}
              disabled={addingCredits}
              title="Add 10 Test Credits (dev only)"
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
            >
              {addingCredits ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              +10
            </button>
          )}

          {/* Credits pill — single source of truth */}
          {user && profile && (
            <Link
              href="/credit-history"
              className="flex items-center gap-2 bg-primary/10 border border-primary/25 rounded-full px-3.5 py-1.5 hover:bg-primary/20 transition-colors"
              title="View Credit History"
            >
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm font-black text-white">{profile.credits}</span>
              <span className="text-xs text-primary/70 font-medium hidden sm:inline">credits</span>
            </Link>
          )}

          {user ? (
            <>
              {/* My Projects icon */}
              <Link
                href="/my-projects"
                title="My Projects"
                className="hidden md:flex items-center justify-center h-9 w-9 rounded-lg border border-white/[0.08] bg-white/[0.02] text-white/40 hover:text-white hover:border-white/20 hover:bg-white/[0.05] transition-colors"
              >
                <FolderOpen className="h-4 w-4" />
              </Link>

              {/* User menu */}
              <div className="relative hidden md:block">
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] text-white/50 hover:text-white hover:border-white/20 hover:bg-white/[0.05] transition-colors text-xs font-medium max-w-[140px]"
                >
                  <User className="h-3.5 w-3.5 shrink-0 text-white/30" />
                  <span className="truncate">{displayName}</span>
                  <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
                </button>
                {userMenuOpen && (
                  <>
                    {/* Backdrop */}
                    <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1.5 w-44 z-50 rounded-xl border border-white/[0.10] bg-zinc-950/95 backdrop-blur-xl shadow-2xl overflow-hidden">
                      <div className="px-3.5 py-2.5 border-b border-white/[0.06]">
                        <p className="text-[11px] font-bold text-white/50 truncate">{displayName}</p>
                        <p className="text-[10px] text-white/25 truncate">{user.email}</p>
                      </div>
                      <div className="py-1">
                        <Link
                          href="/credit-history"
                          onClick={() => setUserMenuOpen(false)}
                          className="flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-white/55 hover:text-white hover:bg-white/[0.05] transition-colors"
                        >
                          <Zap className="h-3.5 w-3.5 text-primary/60" />
                          Credit History
                        </Link>
                        <Link
                          href="/my-projects"
                          onClick={() => setUserMenuOpen(false)}
                          className="flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-white/55 hover:text-white hover:bg-white/[0.05] transition-colors"
                        >
                          <FolderOpen className="h-3.5 w-3.5 text-white/30" />
                          My Projects
                        </Link>
                        <button
                          onClick={handleSignOut}
                          className="flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-red-400/60 hover:text-red-400 hover:bg-red-500/[0.06] transition-colors w-full"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          Sign Out
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <Link
              href="/login"
              className="hidden md:inline-flex items-center px-4 py-1.5 rounded-full text-sm font-semibold bg-primary/10 border border-primary/25 text-primary hover:bg-primary/20 transition-colors"
            >
              Sign In
            </Link>
          )}

          {/* Mobile hamburger */}
          <button
            className="flex lg:hidden items-center justify-center h-8 w-8 rounded-lg text-white/60 hover:text-white transition-colors"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="lg:hidden border-t border-white/[0.06] bg-black/95 backdrop-blur-xl px-5 py-4 space-y-1">
          {user && (
            <div className="pb-3 mb-2 border-b border-white/[0.05]">
              <ModeToggle compact />
            </div>
          )}
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className={`flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                location === link.href
                  ? "text-white bg-white/[0.07]"
                  : "text-white/50 hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-2 border-t border-white/[0.05] mt-2 space-y-1">
            {user ? (
              <>
                <Link
                  href="/my-projects"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-white/55 hover:text-white hover:bg-white/[0.04] transition-colors"
                >
                  <FolderOpen className="h-4 w-4 text-white/30" />
                  My Projects
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-white/55 hover:text-white hover:bg-white/[0.04] transition-colors"
                >
                  <Settings className="h-4 w-4 text-white/30" />
                  Settings
                </Link>
                <Link
                  href="/credit-history"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-primary/70 hover:text-primary hover:bg-primary/[0.05] transition-colors"
                >
                  <Zap className="h-4 w-4" />
                  Credit History
                  {profile && (
                    <span className="ml-auto text-xs font-black text-primary">{profile.credits} credits</span>
                  )}
                </Link>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    window.dispatchEvent(new CustomEvent("open-help-panel"));
                  }}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-primary/70 hover:text-primary hover:bg-primary/[0.05] transition-colors w-full"
                >
                  <HelpCircle className="h-4 w-4" />
                  Need Help?
                </button>
                <button
                  onClick={() => { setMenuOpen(false); handleSignOut(); }}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-red-400/60 w-full hover:text-red-400 hover:bg-red-500/[0.05] transition-colors"
                >
                  <LogOut className="h-4 w-4" /> Sign Out
                </button>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-primary w-full hover:bg-primary/5 transition-colors"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
