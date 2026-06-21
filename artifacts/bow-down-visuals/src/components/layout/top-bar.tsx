import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Zap, FolderOpen, LogOut, Menu, X, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const NAV_LINKS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "My Projects", href: "/my-projects" },
  { label: "Artist Vault", href: "/artist-vault" },
  { label: "Pricing", href: "/pricing" },
  { label: "Waitlist", href: "/waitlist" },
];

export function TopBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const { user, profile, signOut } = useAuth();

  async function handleSignOut() {
    await signOut();
    setLocation("/");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-5 md:px-8 h-28 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="cursor-pointer shrink-0">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Bow Down Visuals"
            className="h-28 w-auto"
            style={{ filter: "brightness(3) saturate(0) drop-shadow(0 0 8px rgba(138,43,226,0.65))" }}
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
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
        <div className="flex items-center gap-2.5">
          {user && profile && (
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/25 rounded-full px-3.5 py-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm font-bold text-white">{profile.credits}</span>
              <span className="text-xs text-primary/70 font-medium hidden sm:inline">credits</span>
            </div>
          )}

          {user ? (
            <>
              <Link href="/my-projects" className="hidden md:flex items-center gap-1.5 text-sm font-medium text-white/45 hover:text-white transition-colors">
                <FolderOpen className="h-4 w-4" />
              </Link>
              <div className="hidden md:flex items-center gap-1 text-xs text-white/30 font-medium truncate max-w-[120px]">
                <User className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{profile?.display_name ?? user.email?.split("@")[0]}</span>
              </div>
              <button
                onClick={handleSignOut}
                title="Sign Out"
                className="hidden md:flex items-center justify-center h-8 w-8 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/5 transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          ) : (
            <Link href="/login" className="hidden md:inline-flex items-center px-4 py-1.5 rounded-full text-sm font-semibold bg-primary/10 border border-primary/25 text-primary hover:bg-primary/20 transition-colors">
              Sign In
            </Link>
          )}

          {/* Mobile hamburger */}
          <button
            className="flex md:hidden items-center justify-center h-8 w-8 rounded-lg text-white/60 hover:text-white transition-colors"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-white/[0.06] bg-black/95 backdrop-blur-xl px-5 py-4 space-y-1">
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
              <button
                onClick={() => { setMenuOpen(false); handleSignOut(); }}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-red-400/70 w-full hover:text-red-400 hover:bg-red-500/5 transition-colors"
              >
                <LogOut className="h-4 w-4" /> Sign Out
              </button>
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
