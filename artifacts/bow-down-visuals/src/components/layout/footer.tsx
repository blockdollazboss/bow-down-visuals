import { Link } from "wouter";
import { Mail } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="bg-black border-t border-white/[0.06] py-12 px-5">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8 mb-10">

          {/* Brand */}
          <div className="shrink-0">
            <Link href="/" className="cursor-pointer inline-block">
              <img
                src={`${import.meta.env.BASE_URL}logo.png`}
                alt="Bow Down Visuals"
                className="h-20 w-auto"
                style={{ filter: "drop-shadow(0 0 1.5px rgba(255,255,255,0.5))" }}
              />
            </Link>
            <p className="text-white/50 text-sm font-semibold mt-2">Bow Down Visuals</p>
            <p className="text-white/30 text-xs mt-1 max-w-xs leading-relaxed">
              Create the Song. Create the Video. Promote the Release.
            </p>
            <a
              href="mailto:support@bowdownvisuals.com"
              className="inline-flex items-center gap-1.5 mt-3 text-xs text-white/40 hover:text-primary transition-colors"
            >
              <Mail className="h-3 w-3 shrink-0" />
              support@bowdownvisuals.com
            </a>
          </div>

          {/* Links */}
          <nav className="flex flex-col gap-2.5">
            <p className="text-white/20 text-xs font-bold uppercase tracking-widest mb-1">Navigate</p>
            <Link href="/waitlist" className="text-sm text-white/50 hover:text-white transition-colors">Waitlist</Link>
            <Link href="/pricing"  className="text-sm text-white/50 hover:text-white transition-colors">Pricing</Link>
            <Link href="/contact"  className="text-sm text-white/50 hover:text-white transition-colors">Contact</Link>
          </nav>
        </div>

        <div className="border-t border-white/[0.05] pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-white/20 text-xs">© 2026 Bow Down Visuals. All rights reserved.</p>
          <p className="text-white/15 text-xs">Built for independent artists.</p>
        </div>
      </div>
    </footer>
  );
}
