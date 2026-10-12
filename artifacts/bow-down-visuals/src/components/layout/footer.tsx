import { Link } from "wouter";
import { Mail, Sparkles } from "lucide-react";
import { JsonLd, ORGANIZATION_JSON_LD, WEBSITE_JSON_LD } from "@/components/seo/json-ld";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { InstagramIcon, TikTokIcon, YouTubeIcon, SOCIAL_HANDLE } from "@/components/social-icons";
import { ThemedLogo } from "@/components/ThemedLogo";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

const NAVIGATE = [
  { label: "Home",        href: "/" },
  { label: "Pricing",     href: "/pricing" },
  { label: "Beta Access", href: "/beta-access" },
  { label: "Waitlist",    href: "/waitlist" },
  { label: "Download the App", href: "/download" },
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

/* Public template galleries (SEO lead magnets) — internal links from every
   page's footer are what make the galleries rank and convert. */
const TEMPLATE_LINKS = [
  { label: "Template Library", href: "/templates" },
  { label: "Video Templates", href: "/templates/videos" },
  { label: "Thumbnail Templates", href: "/templates/thumbnails" },
  { label: "Hook Templates", href: "/templates/hooks" },
  { label: "Caption Packs", href: "/templates/captions" },
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
  const isLight = useIsLightTheme();
  /* Theme-aware text tones: warm bronze on cream (light), white washes on black (dark). */
  const T = {
    label: isLight ? "text-[#8a6d2f]" : "text-white/20",
    link: isLight ? "text-[#4A3B22] hover:text-[#8a6d2f]" : "text-white/45 hover:text-white",
    body: isLight ? "text-[#4A3B22]/80" : "text-white/35",
    muted: isLight ? "text-[#8a6d2f]/70 hover:text-primary" : "text-white/40 hover:text-primary",
    copy: isLight ? "text-[#8a6d2f]/70" : "text-white/20",
    fine: isLight ? "text-[#8a6d2f]/50" : "text-white/15",
    icon: isLight ? "text-[#8a6d2f]" : "text-white/50",
    border: isLight ? "border-[#c9a84c]/25" : "border-white/[0.05]",
    socialBorder: isLight ? "border-[#c9a84c]/40 bg-[#FDFBF5]" : "border-white/10 bg-white/[0.03]",
  };

  return (
    <footer className={`relative z-[2] border-t py-12 px-5 ${isLight ? "bg-gradient-to-b from-[#F7F1E3] to-[#EFE6D0] border-[#c9a84c]/25" : "bg-black border-transparent"}`}>
      {/* z-[2]: the homepage lives in an isolated z-[1] stacking context whose
          fixed full-viewport stage backdrop would otherwise paint over the
          footer and swallow it. The footer must sit above the page root. */}
      {/* Hairline gold rule above the footer */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" aria-hidden="true" />
      <JsonLd data={ORGANIZATION_JSON_LD} />
      <JsonLd data={WEBSITE_JSON_LD} />
      <div className="max-w-6xl mx-auto">

        {/* Top row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-7 gap-10 mb-10">

          {/* Navigate */}
          <nav className="flex flex-col gap-2.5" aria-label="Footer">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>Navigate</p>
            {NAVIGATE.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* AI Tools */}
          <nav className="flex flex-col gap-2.5" aria-label="AI tools">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>AI Tools</p>
            {AI_TOOLS_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* For Creators */}
          <nav className="flex flex-col gap-2.5" aria-label="For creators">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>For Creators</p>
            {CREATOR_HUB_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Templates */}
          <nav className="flex flex-col gap-2.5" aria-label="Templates">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>Templates</p>
            {TEMPLATE_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Legal */}
          <nav className="flex flex-col gap-2.5" aria-label="Legal">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>Legal</p>
            {LEGAL.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Brand — right side */}
          <div className="sm:col-span-2 md:col-span-2">
            <Link href="/" ref={logoTilt} className="cursor-pointer inline-block rounded-lg" aria-label="Bow Down Visuals — home">
              <ThemedLogo className="h-40 w-auto" />
            </Link>
            <p className="font-display italic text-primary/85 text-[15px] mt-4">
              The content creator&rsquo;s cheat code.
            </p>
            <span className="inline-flex items-center gap-1.5 mt-3 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Powered by Thy Cheat Code
            </span>
            <p className={`${T.body} text-xs mt-3 max-w-xs leading-relaxed`}>
              AI creator studio for lyrics, music video plans, video prompts,
              captions, thumbnails, promo clips, and more.
            </p>
            <a
              href="/contact"
              className={`inline-flex items-center gap-1.5 mt-4 text-xs ${T.muted} transition-colors`}
            >
              <Mail className="h-3 w-3 shrink-0" />
              Contact Us
            </a>
          </div>

        </div>

        {/* Bottom bar */}
        <div className={`border-t ${T.border} pt-6 flex flex-col sm:flex-row items-center justify-between gap-3`}>
          <p className={`${T.copy} text-xs pl-[14%] sm:pl-[10%]`}>© 2026 Bow Down Visuals. All rights reserved.</p>
          <p className={`${T.fine} text-[10px] pl-[14%] sm:pl-[10%] mt-1`}>All game titles, trademarks, and platform names are property of their respective owners. No affiliation or endorsement implied.</p>
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
                  className={`h-10 w-10 rounded-full border ${T.socialBorder} inline-flex items-center justify-center ${T.icon} cursor-not-allowed hover:text-primary hover:border-primary/40 transition-colors`}
                >
                  <Icon className="h-5 w-5" />
                </span>
              ))}
            </div>
            <p className={`${T.muted} text-xs`}>@BowDownVisuals</p>
          </div>
          <p className={`${T.fine} text-[10px] select-none`} title="every arcade has its secrets">
            psst&hellip; this site has a cheat code
          </p>
          <div className="flex items-center gap-4">
            <Link href="/terms"         className={`${T.copy} text-xs hover:opacity-70 transition-colors`}>Terms</Link>
            <Link href="/privacy"       className={`${T.copy} text-xs hover:opacity-70 transition-colors`}>Privacy</Link>
            <Link href="/refund-policy" className={`${T.copy} text-xs hover:opacity-70 transition-colors`}>Refunds</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
