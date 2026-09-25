import { Link } from "wouter";
import { Mail, Sparkles } from "lucide-react";
import { JsonLd, ORGANIZATION_JSON_LD, WEBSITE_JSON_LD } from "@/components/seo/json-ld";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";

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
  /* Same cursor-tilt + gold-glow treatment as the header brand mark. */
  const logoTilt = useTiltOnHover<HTMLAnchorElement>({ maxDeg: 8, maxShift: 6 });

  return (
    <footer className="relative bg-black border-t border-transparent py-12 px-5">
      {/* Hairline gold rule above the footer */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" aria-hidden="true" />
      <JsonLd data={ORGANIZATION_JSON_LD} />
      <JsonLd data={WEBSITE_JSON_LD} />
      <div className="max-w-6xl mx-auto">

        {/* Top row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-10">

          {/* Brand */}
          <div>
            <Link href="/" ref={logoTilt} className="cursor-pointer inline-block rounded-lg" aria-label="Bow Down Visuals — home">
              <img
                src={`${import.meta.env.BASE_URL}logo-static.png`}
                alt="Bow Down Visuals"
                className="h-40 w-auto"
              />
            </Link>
            <p className="font-display italic text-primary/85 text-[15px] mt-4">
              The content creator&rsquo;s cheat code.
            </p>
            <p className="text-white/35 text-xs mt-3 max-w-xs leading-relaxed">
              AI creator credits for lyrics, music video plans, video prompts,
              captions, thumbnails, promo clips, and more.
            </p>
            <span className="inline-flex items-center gap-1.5 mt-4 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Powered by GPT-6
            </span>
            <a
              href="mailto:support@bowdownvisuals.com"
              className="inline-flex items-center gap-1.5 mt-4 text-xs text-white/40 hover:text-primary transition-colors"
            >
              <Mail className="h-3 w-3 shrink-0" />
              support@bowdownvisuals.com
            </a>
          </div>

          {/* Navigate */}
          <nav className="flex flex-col gap-2.5" aria-label="Footer">
            <p className="text-white/20 text-[10px] font-bold uppercase tracking-widest mb-1">Navigate</p>
            {NAVIGATE.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm text-white/45 hover:text-white transition-colors w-fit"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Legal */}
          <nav className="flex flex-col gap-2.5" aria-label="Legal">
            <p className="text-white/20 text-[10px] font-bold uppercase tracking-widest mb-1">Legal</p>
            {LEGAL.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm text-white/45 hover:text-white transition-colors w-fit"
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
