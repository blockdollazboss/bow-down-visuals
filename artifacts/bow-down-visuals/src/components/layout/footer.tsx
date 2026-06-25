import { Link } from "wouter";
import { Mail } from "lucide-react";

const NAVIGATE = [
  { label: "Home",        href: "/" },
  { label: "Pricing",     href: "/pricing" },
  { label: "Beta Access", href: "/beta-access" },
  { label: "Waitlist",    href: "/waitlist" },
  { label: "Contact / Support", href: "/contact" },
];

const LEGAL = [
  { label: "Terms of Service", href: "/terms" },
  { label: "Privacy Policy",   href: "/privacy" },
  { label: "Refund Policy",    href: "/refund-policy" },
];

export function SiteFooter() {
  return (
    <footer className="bg-black border-t border-white/[0.06] py-14 px-5">
      <div className="max-w-6xl mx-auto">

        {/* Top row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-10">

          {/* Brand */}
          <div>
            <Link href="/" className="cursor-pointer inline-block">
              <img
                src={`${import.meta.env.BASE_URL}logo-static.png`}
                alt="Bow Down Visuals"
                className="h-24 w-auto"
              />
            </Link>
            <p className="text-white/60 text-sm font-semibold mt-2">Bow Down Visuals</p>
            <p className="text-white/35 text-xs mt-2 max-w-xs leading-relaxed">
              Bow Down Visuals sells digital AI creator credits for lyrics, music video plans,
              video prompts, captions, thumbnails, promo clips, and related digital creator tools.
            </p>
            <a
              href="mailto:support@bowdownvisuals.com"
              className="inline-flex items-center gap-1.5 mt-4 text-xs text-white/40 hover:text-primary transition-colors"
            >
              <Mail className="h-3 w-3 shrink-0" />
              support@bowdownvisuals.com
            </a>
          </div>

          {/* Navigate */}
          <nav className="flex flex-col gap-2.5">
            <p className="text-white/20 text-[10px] font-bold uppercase tracking-widest mb-1">Navigate</p>
            {NAVIGATE.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm text-white/45 hover:text-white transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Legal */}
          <nav className="flex flex-col gap-2.5">
            <p className="text-white/20 text-[10px] font-bold uppercase tracking-widest mb-1">Legal</p>
            {LEGAL.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm text-white/45 hover:text-white transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/[0.05] pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-white/20 text-xs">© 2026 Bow Down Visuals. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/terms"         className="text-white/20 text-xs hover:text-white/50 transition-colors">Terms</Link>
            <Link href="/privacy"       className="text-white/20 text-xs hover:text-white/50 transition-colors">Privacy</Link>
            <Link href="/refund-policy" className="text-white/20 text-xs hover:text-white/50 transition-colors">Refunds</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
