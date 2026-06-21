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
                className="h-44 w-auto"
                style={{ filter: "brightness(1.1) drop-shadow(0 0 8px rgba(218,165,32,0.6))" }}
              />
            </Link>
            <p className="text-white/30 text-sm mt-3 max-w-xs leading-relaxed">
              Create the Song. Create the Video. Promote the Release.
            </p>
          </div>

          {/* Links */}
          <nav className="flex flex-col sm:flex-row gap-6 sm:gap-10">
            <div className="flex flex-col gap-2.5">
              <p className="text-white/20 text-xs font-bold uppercase tracking-widest mb-1">Platform</p>
              <Link href="/waitlist" className="text-sm text-white/50 hover:text-white transition-colors">Waitlist</Link>
              <Link href="/pricing" className="text-sm text-white/50 hover:text-white transition-colors">Pricing</Link>
              <Link href="/dashboard" className="text-sm text-white/50 hover:text-white transition-colors">Dashboard</Link>
            </div>
            <div className="flex flex-col gap-2.5">
              <p className="text-white/20 text-xs font-bold uppercase tracking-widest mb-1">Contact</p>
              <a
                href="mailto:support@bowdownvisuals.com"
                className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" />
                support@bowdownvisuals.com
              </a>
            </div>
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
