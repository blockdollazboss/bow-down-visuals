import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Zap, FolderOpen, Settings, Menu, X } from "lucide-react";

interface TopBarProps {
  credits?: number;
  showCredits?: boolean;
}

const NAV_LINKS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "My Projects", href: "/my-projects" },
  { label: "Artist Vault", href: "/artist-vault" },
  { label: "Pricing", href: "/pricing" },
];

export function TopBar({ credits = 3, showCredits = true }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="flex flex-col leading-none cursor-pointer shrink-0">
          <span className="text-white font-black text-base tracking-tight">BOW DOWN</span>
          <span className="text-primary font-black text-sm tracking-widest -mt-0.5">VISUALS</span>
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
        <div className="flex items-center gap-3">
          {showCredits && (
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/25 rounded-full px-3.5 py-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm font-bold text-white">{credits}</span>
              <span className="text-xs text-primary/70 font-medium hidden sm:inline">credits</span>
            </div>
          )}
          <Link href="/my-projects" className="hidden md:flex items-center gap-1.5 text-sm font-medium text-white/45 hover:text-white transition-colors">
            <FolderOpen className="h-4 w-4" />
          </Link>
          <button className="hidden md:flex items-center justify-center h-8 w-8 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors">
            <Settings className="h-4 w-4" />
          </button>

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
          <div className="pt-2 border-t border-white/[0.05] mt-2">
            <button className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-white/40 w-full hover:text-white hover:bg-white/[0.04] transition-colors">
              <Settings className="h-4 w-4" /> Settings
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
