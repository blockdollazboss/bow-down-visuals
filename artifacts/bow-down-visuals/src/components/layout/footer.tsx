import { Link } from "wouter";
import { Mail, Sparkles } from "lucide-react";
import { JsonLd, ORGANIZATION_JSON_LD, WEBSITE_JSON_LD } from "@/components/seo/json-ld";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { InstagramIcon, TikTokIcon, YouTubeIcon, SOCIAL_HANDLE } from "@/components/social-icons";

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

/* SEO hubs (Worker 9) — index pages link onward to every tool/vertical/genre
   page, so the footer carries the hubs plus the top money pages. */
const AI_TOOLS_LINKS = [
  { label: "All AI Tools", href: "/tools" },
  { label: "AI Thumbnail Maker", href: "/tools/ai-thumbnail-maker" },
  { label: "AI Hook Generator", href: "/tools/ai-hook-generator" },
  { label: "AI Music Video Maker", href: "/tools/ai-music-video-maker" },
  { label: "AI Caption Generator", href: "/tools/ai-caption-generator" },
  { label: "AI Clip Maker", href: "/tools/ai-clip-maker" },
  { label: "AI Song Maker", href: "/tools/ai-song-maker" },
];

const CREATOR_HUB_LINKS = [
  { label: "For Creators", href: "/for" },
  { label: "For YouTubers", href: "/for/youtubers" },
  { label: "For Podcasters", href: "/for/podcasters" },
  { label: "For Streamers", href: "/for/streamers" },
  { label: "For Musicians", href: "/for/musicians" },
  { label: "For TikTokers", href: "/for/tiktokers" },
  { label: "Browse Genres", href: "/genres" },
];

/* Social channels — accounts are being created; links go live with real URLs then.
 * To make clickable: replace the <span> with <a href="URL"> in the bottom
 * social row below (marked with data-social-link). */
const SOCIALS_COMING_SOON = [
  { label: "Instagram", Icon: InstagramIcon, key: "instagram" },
  { label: "TikTok",    Icon: TikTokIcon,    key: "tiktok" },
  { label: "YouTube",   Icon: YouTubeIcon,   key: "youtube" },
];

export function SiteFooter() {
  /* Same cursor-tilt + gold-glow treatment as the header brand mark. */
  const logoTilt = useTiltOnHover<HTMLAnchorElement>({ maxDeg: 8, maxShift: 6 });

  return (
    <footer className="relative z-[2] bg-black border-t border-transparent py-12 px-5">
      {/* z-[2]: the homepage lives in an isolated z-[1] stacking context whose
          fixed full-viewport stage backdrop would otherwise paint over the
          footer and swallow it. The footer must sit above the page root. */}
      {/* Hairline gold rule above the footer */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" aria-hidden="true" />
      <JsonLd data={ORGANIZATION_JSON_LD} />
      <JsonLd data={WEBSITE_JSON_LD} />
      <div className="max-w-6xl mx-auto">

        {/* Top row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-10 mb-10">

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

          {/* AI Tools */}
          <nav className="flex flex-col gap-2.5" aria-label="AI tools">
            <p className="text-white/20 text-[10px] font-bold uppercase tracking-widest mb-1">AI Tools</p>
            {AI_TOOLS_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm text-white/45 hover:text-white transition-colors w-fit"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* For Creators */}
          <nav className="flex flex-col gap-2.5" aria-label="For creators">
            <p className="text-white/20 text-[10px] font-bold uppercase tracking-widest mb-1">For Creators</p>
            {CREATOR_HUB_LINKS.map((l) => (
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

          {/* Brand — right side */}
          <div className="sm:col-span-2 md:col-span-2">
            <Link href="/" ref={logoTilt} className="cursor-pointer inline-block rounded-lg" aria-label="Bow Down Visuals — home">
              <img
                src={`${import.meta.env.BASE_URL}logo-static.webp`}
                alt="Bow Down Visuals"
                className="h-40 w-auto"
              />
            </Link>
            <p className="font-display italic text-primary/85 text-[15px] mt-4">
              The content creator&rsquo;s cheat code.
            </p>
            <span className="inline-flex items-center gap-1.5 mt-3 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Powered by Thy Cheat Code
            </span>
            <p className="text-white/35 text-xs mt-3 max-w-xs leading-relaxed">
              AI creator studio for lyrics, music video plans, video prompts,
              captions, thumbnails, promo clips, and more.
            </p>
            <a
              href="/contact"
              className="inline-flex items-center gap-1.5 mt-4 text-xs text-white/40 hover:text-primary transition-colors"
            >
              <Mail className="h-3 w-3 shrink-0" />
              Contact Us
            </a>
          </div>

        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/[0.05] pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-white/20 text-xs pl-[14%] sm:pl-[10%]">© 2026 Bow Down Visuals. All rights reserved.</p>
          <p className="text-white/15 text-[10px] pl-[14%] sm:pl-[10%] mt-1">All game titles, trademarks, and platform names are property of their respective owners. No affiliation or endorsement implied.</p>
          {/* Social row — swap <span> for <a href="…"> to go live (see data-social-link) */}
          <div className="flex flex-col items-center gap-2" aria-label="Social media">
            <div className="flex items-center gap-3">
              {SOCIALS_COMING_SOON.map(({ label, Icon, key }) => (
                <span
                  key={key}
                  data-social-link={key}
                  title={`${label} — coming soon`}
                  aria-label={`${label} (coming soon)`}
                  aria-disabled="true"
                  className="h-10 w-10 rounded-full border border-white/10 bg-white/[0.03] inline-flex items-center justify-center text-white/50 cursor-not-allowed hover:text-primary hover:border-primary/40 transition-colors"
                >
                  <Icon className="h-5 w-5" />
                </span>
              ))}
            </div>
            <p className="text-white/40 text-xs">@BowDownVisuals</p>
          </div>
          <p className="text-white/[0.13] text-[10px] select-none" title="every arcade has its secrets">
            psst&hellip; this site has a cheat code
          </p>
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
