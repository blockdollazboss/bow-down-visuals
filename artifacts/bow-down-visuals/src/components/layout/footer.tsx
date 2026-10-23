import { Link } from "wouter";
import { Mail, Sparkles } from "lucide-react";
import { JsonLd, ORGANIZATION_JSON_LD, WEBSITE_JSON_LD } from "@/components/seo/json-ld";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { InstagramIcon, TikTokIcon, YouTubeIcon, SOCIAL_HANDLE } from "@/components/social-icons";
import { ThemedLogo } from "@/components/ThemedLogo";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { SHORTS_NAV_ENTRY } from "@/lib/shorts-navigation";

const STUDIO_LINKS = [
  { label: "Home",        href: "/" },
  { label: "Beta Access", href: "/beta-access" },
  { label: "Download the App", href: "/download" },
  { label: "Contact / Support", href: "/contact" },
];

const LEGAL = [
  { label: "Terms of Service", href: "/terms" },
  { label: "Privacy Policy",   href: "/privacy" },
  { label: "Refund Policy",    href: "/refund-policy" },
];

/* Link columns speak the six areas — the same taxonomy as the sidebar,
   the feature registry, and the hub workflows: Create, Branding, Promote,
   Social, Business / Get Paid, My Studio (+ Legal). The /for/* audience
   hubs sit in their own honestly-labeled "For Creators" column — they are
   SEO landing pages, not the app's Social surfaces. Every href lands on a
   real route — no redirect aliases. */
const CREATE_LINKS = [
  { label: "All AI Tools", href: "/tools" },
  { label: "AI Thumbnail Maker", href: "/tools/ai-thumbnail-maker" },
  { label: "AI Music Video Maker", href: "/tools/ai-music-video-maker" },
  { label: "AI Song Maker", href: "/tools/ai-song-maker" },
  /* Hook Studio lives under Create (sidebar + registry agree) — its SEO
     page sits with the other Create tool pages, not under Promote. */
  { label: "AI Hook Generator", href: "/tools/ai-hook-generator" },
  /* Template galleries (members; SEO lead magnets) — internal links from
     every page's footer are what make the galleries rank and convert. */
  { label: "Template Library", href: "/templates" },
  { label: "Video Templates", href: "/templates/videos" },
  { label: "Thumbnail Templates", href: "/templates/thumbnails" },
  { label: "Hook Templates", href: "/templates/hooks" },
  { label: "Caption Packs", href: "/templates/captions" },
];

const BRANDING_LINKS = [
  { label: "Branding Kit", href: "/branding-kit" },
  { label: "Logo Maker", href: "/branding-kit?tab=logo" },
  { label: "Intros & Outros", href: "/branding-kit?tab=intros" },
  { label: "Stream Packs", href: "/branding-kit?tab=stream" },
  { label: "Branding Shop", href: "/branding-kit?tab=shop" },
];

const PROMOTE_LINKS = [
  { label: "Promo Generator", href: "/promote" },
  { label: "AI Caption Generator", href: "/tools/ai-caption-generator" },
  { label: "AI Clip Maker", href: "/tools/ai-clip-maker" },
];

const BUSINESS_LINKS = [
  { label: "Pricing", href: "/pricing" },
  { label: "Money Coach", href: "/coach" },
  { label: "Brand Deals", href: "/brand-deals" },
  { label: "Distribute", href: "/distribute" },
  { label: "Tips", href: "/tips" },
  { label: "Memberships", href: "/memberships" },
  { label: "Storefronts", href: "/storefronts" },
  { label: "My Shop", href: "/my-shop" },
];

/* The app's real Social surfaces — the same doors the sidebar's Social
   section carries. */
const SOCIAL_LINKS = [
  { label: "Home Feed", href: "/home" },
  { label: SHORTS_NAV_ENTRY.label, href: SHORTS_NAV_ENTRY.href },
  { label: "Explore", href: "/explore" },
  { label: "Groups", href: "/groups" },
  { label: "Contests", href: "/contests" },
  { label: "Winners' Circle", href: "/winners" },
];

/* SEO audience hubs — landing pages per creator type, NOT app surfaces. */
const CREATOR_LINKS = [
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
  const isLight = useIsLightTheme();
  /* Theme-aware text tones: warm bronze on cream (light), white washes on black (dark). */
  const T = {
    label: isLight ? "text-[#8a6d2f]" : "text-white/50",
    link: isLight ? "text-[#4A3B22] hover:text-[#8a6d2f]" : "text-white/60 hover:text-white",
    body: isLight ? "text-[#4A3B22]/80" : "text-white/35",
    muted: isLight ? "text-[#8a6d2f]/70 hover:text-primary" : "text-white/40 hover:text-primary",
    copy: isLight ? "text-[#8a6d2f]/70" : "text-white/45",
    fine: isLight ? "text-[#8a6d2f]/50" : "text-white/35",
    icon: isLight ? "text-[#8a6d2f]" : "text-white/50",
    border: isLight ? "border-[#c9a84c]/25" : "border-[#C9A84C]/20",
    socialBorder: isLight ? "border-[#c9a84c]/40 bg-[#FDFBF5]" : "border-[#C9A84C]/30 bg-[#C9A84C]/[0.05]",
  };

  return (
    <footer className={`relative z-[2] border-t py-12 px-5 ${isLight ? "bg-gradient-to-b from-[#F7F1E3] to-[#EFE6D0] border-[#c9a84c]/25" : "bg-gradient-to-b from-[#14100a] to-[#0d0a04] border-[#C9A84C]/25"}`}>
      {/* z-[2]: the homepage lives in an isolated z-[1] stacking context whose
          fixed full-viewport stage backdrop would otherwise paint over the
          footer and swallow it. The footer must sit above the page root. */}
      {/* Hairline gold rule above the footer */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" aria-hidden="true" />
      <JsonLd data={ORGANIZATION_JSON_LD} />
      <JsonLd data={WEBSITE_JSON_LD} />
      <div className="max-w-6xl mx-auto">

        {/* Top row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-10 gap-8 mb-10">

          {/* Create */}
          <nav className="flex flex-col gap-1 md:gap-2.5" aria-label="Create">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>Create</p>
            {CREATE_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit flex items-center min-h-[40px] py-2 md:min-h-0 md:py-0`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Branding */}
          <nav className="flex flex-col gap-1 md:gap-2.5" aria-label="Branding">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>Branding</p>
            {BRANDING_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit flex items-center min-h-[40px] py-2 md:min-h-0 md:py-0`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Promote */}
          <nav className="flex flex-col gap-1 md:gap-2.5" aria-label="Promote">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>Promote</p>
            {PROMOTE_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit flex items-center min-h-[40px] py-2 md:min-h-0 md:py-0`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Social */}
          <nav className="flex flex-col gap-1 md:gap-2.5" aria-label="Social">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>Social</p>
            {SOCIAL_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit flex items-center min-h-[40px] py-2 md:min-h-0 md:py-0`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* For Creators — SEO audience hubs */}
          <nav className="flex flex-col gap-1 md:gap-2.5" aria-label="For Creators">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>For Creators</p>
            {CREATOR_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit flex items-center min-h-[40px] py-2 md:min-h-0 md:py-0`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Business / Get Paid */}
          <nav className="flex flex-col gap-1 md:gap-2.5" aria-label="Business / Get Paid">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>Business / Get Paid</p>
            {BUSINESS_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit flex items-center min-h-[40px] py-2 md:min-h-0 md:py-0`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* My Studio */}
          <nav className="flex flex-col gap-1 md:gap-2.5" aria-label="My Studio">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>My Studio</p>
            {STUDIO_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit flex items-center min-h-[40px] py-2 md:min-h-0 md:py-0`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Legal */}
          <nav className="flex flex-col gap-1 md:gap-2.5" aria-label="Legal">
            <p className={`${T.label} text-[10px] font-bold uppercase tracking-widest mb-1`}>Legal</p>
            {LEGAL.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm ${T.link} transition-colors w-fit flex items-center min-h-[40px] py-2 md:min-h-0 md:py-0`}
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
              className={`inline-flex items-center gap-1.5 mt-4 py-2 -my-1 text-xs ${T.muted} transition-colors`}
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
            <Link href="/terms"         className={`${T.copy} text-xs hover:opacity-70 transition-colors inline-flex items-center min-h-[40px] md:min-h-0 py-2`}>Terms</Link>
            <Link href="/privacy"       className={`${T.copy} text-xs hover:opacity-70 transition-colors inline-flex items-center min-h-[40px] md:min-h-0 py-2`}>Privacy</Link>
            <Link href="/refund-policy" className={`${T.copy} text-xs hover:opacity-70 transition-colors inline-flex items-center min-h-[40px] md:min-h-0 py-2`}>Refunds</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
