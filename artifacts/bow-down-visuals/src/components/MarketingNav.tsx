import { useState } from "react";
import { Link } from "wouter";
import { Menu, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { useAuth } from "@/contexts/AuthContext";

/**
 * MarketingNav — the single shared nav for all marketing pages
 * (home, pricing, contact, waitlist, beta-access).
 *
 * Consistent links: Home · Pricing · Tools · Waitlist, plus Sign In
 * (or Dashboard when already signed in) and a gold "Start Creating"
 * CTA. The mobile menu carries the same links. The brand mark tilts
 * toward the cursor on desktop (gated inside useTiltOnHover).
 */
const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Pricing", href: "/pricing" },
  { label: "Randomizer", href: "/randomizer" },
  { label: "Hook Studio", href: "/hooks" },
  { label: "Comment Replies", href: "/comment-replies" },
  { label: "Money Coach", href: "/coach" },
  { label: "Content Calendar", href: "/content-calendar" },
  { label: "Press Kits", href: "/press-kit" },
  { label: "Release Planner", href: "/release" },
  { label: "Samples", href: "/samples" },
  { label: "Tools", href: "/dashboard" },
  { label: "Waitlist", href: "/waitlist" },
];

const DESKTOP_LINK =
  "lux-nav-link px-3.5 py-1.5 rounded-lg text-sm font-medium text-white/45 hover:text-white hover:bg-white/[0.04] transition-colors";
const MOBILE_LINK =
  "flex items-center px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white hover:bg-white/[0.04] transition-colors";

export function MarketingNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const logoTilt = useTiltOnHover<HTMLAnchorElement>({ maxDeg: 8, maxShift: 6 });
  /* Signed-in visitors should never be offered "Sign In" — that click just
   * bounced them through /login back into the app. Show Dashboard instead. */
  const { user } = useAuth();
  const signedIn = !!user;

  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-black/80 backdrop-blur-2xl">
      <div className="max-w-7xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between gap-4">
        <Link
          href="/"
          ref={logoTilt}
          className="cursor-pointer shrink-0 inline-block rounded-lg"
          aria-label="Bow Down Visuals — home"
        >
          <img
            src={`${import.meta.env.BASE_URL}logo-static.png`}
            alt="Bow Down Visuals"
            className="h-14 w-auto"
          />
        </Link>

        <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={DESKTOP_LINK}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          {signedIn ? (
            <Link href="/dashboard" className="hidden md:inline-flex">
              <Button
                variant="ghost"
                size="sm"
                className="text-white/60 hover:text-white hover:bg-white/[0.06] font-semibold"
              >
                Dashboard
              </Button>
            </Link>
          ) : (
            <Link href="/login" className="hidden md:inline-flex">
              <Button
                variant="ghost"
                size="sm"
                className="text-white/60 hover:text-white hover:bg-white/[0.06] font-semibold"
              >
                Sign In
              </Button>
            </Link>
          )}
          <Link href="/dashboard" className="hidden md:inline-flex">
            <Button size="sm" variant="luxury" className="px-5 gap-1.5">
              Start Creating <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <button
            className="flex md:hidden items-center justify-center h-9 w-9 rounded-lg text-white/60 hover:text-white hover:bg-white/[0.05] transition-colors"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-white/[0.06] bg-black/95 backdrop-blur-xl px-5 py-4 space-y-1">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className={MOBILE_LINK}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href={signedIn ? "/dashboard" : "/login"}
            onClick={() => setMenuOpen(false)}
            className={`${MOBILE_LINK} font-semibold text-primary`}
          >
            {signedIn ? "Dashboard" : "Sign In"}
          </Link>
          <div className="pt-2">
            <Link href="/dashboard" onClick={() => setMenuOpen(false)}>
              <Button size="sm" variant="luxury" className="w-full gap-1.5">
                Start Creating <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      )}
      {/* Hairline gold rule under the nav */}
      <div className="h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" aria-hidden="true" />
    </header>
  );
}
