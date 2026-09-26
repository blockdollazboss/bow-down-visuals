import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Home,
  LayoutDashboard,
  Music,
  Music2,
  Video,
  Film,
  Clapperboard,
  Image,
  Images,
  Sparkles,
  CreditCard,
  Mic2,
  LogOut,
  LogIn,
  Coins,
  ShieldCheck,
  MapPin,
  ChevronsLeft,
  ChevronsUpDown,
  Library,
  Radio,
  GraduationCap,
  Shirt,
  ListMusic,
  SearchCheck,
  Handshake,
  Megaphone,
  ClipboardCheck,
  FolderOpen,
  Zap,
  Settings,
  HelpCircle,
  Wand2,
  SlidersHorizontal,
  Plus,
  Loader2,
  Scissors,
  Lightbulb,
  PenLine,
  Dices,
  Captions,
  Disc3,
  AudioWaveform,
  Waves,
  AudioLines,
  Languages,
  Type,
  CalendarDays,
  Clock,
  MessageSquareReply,
  TrendingUp,
  Repeat,
  DollarSign,
  HeartHandshake,
  Store,
  Newspaper,
  Mail,
  Users,
  Trophy,
  Copyright,
  Scale,
  UsersRound,
  Maximize,
  Eraser,
  MicOff,
  Split,
  Volume2,
  Package,
  Palette,
  Tv,
  FlaskConical,
  Podcast,
  PlaySquare,
  Gamepad2,
  Gem,
  Star,
  Gauge,
  BarChart3,
  Crown,
  type LucideIcon,

} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";

const IS_DEV = import.meta.env.DEV;

/** Simple / Advanced mode switch — ported from the old TopBar so the
 *  toolbar's mode control lives in the sidebar now. */
function ModeToggle() {
  const { stars, setStars } = useUserMode();
  return (
    <div className="w-full space-y-1.5" role="radiogroup" aria-label="Creator level">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">
          Creator Level
        </span>
        <span className="text-[10px] font-black text-primary">
          {stars <= 2 ? "CHILL" : stars <= 4 ? "HEATING UP" : "MOST WANTED"}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1">
        {([1, 2, 3, 4, 5, 6] as const).map((s) => {
          const active = s <= stars;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={stars === s}
              aria-label={`${s} star${s > 1 ? "s" : ""} — ${s <= 3 ? "simple" : "advanced"}`}
              onClick={() => setStars(s)}
              className="flex-1 flex justify-center py-1 transition-transform hover:scale-125 active:scale-95"
              title={s <= 2 ? "Simple — AI does the work" : s <= 4 ? "Balanced" : "Advanced — full manual control"}
            >
              <Star
                className={`h-5 w-5 transition-colors ${
                  active
                    ? "fill-primary text-primary drop-shadow-[0_0_6px_rgba(201,168,76,0.8)]"
                    : "fill-transparent text-white/20 hover:text-white/40"
                }`}
              />
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-white/35 px-0.5">
        {stars <= 2
          ? "AI auto-pilot. Just create."
          : stars <= 4
            ? "AI + your tweaks."
            : "Every knob, every setting."}
      </p>
    </div>
  );
}

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  tour?: string;
}

interface NavSection {
  title: string;
  links: NavLink[];
}

/* ── Grouped navigation: every routed page reachable, no dead links ── */
const SECTIONS: NavSection[] = [
  {
    title: "Home",
    links: [
      { href: "/", label: "Home", icon: Home },
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "Create",
    links: [
      { href: "/song-and-video", label: "Make Song + Video", icon: Mic2 },
      { href: "/make-song", label: "Make a Song", icon: Music },
      { href: "/make-video", label: "Make a Music Video", icon: Video },
      { href: "/video-editor", label: "Video Editor", icon: Clapperboard },
      { href: "/promo-clip", label: "Promo Clip Maker", icon: Film },
      { href: "/clip-maker", label: "AI Streamer Clips", icon: Scissors },
      { href: "/create", label: "Quick Create", icon: Zap },
      { href: "/my-projects", label: "My Projects", icon: FolderOpen },
      { href: "/my-clips", label: "My Clips", icon: Library },
      { href: "/songs", label: "Songs", icon: Music2 },
      { href: "/artist-vault", label: "Artist Vault", icon: ShieldCheck },
      { href: "/locations", label: "Locations", icon: MapPin },
      { href: "/jewelry", label: "Logo-to-Luxury Studio", icon: Gem },
      { href: "/gamers", label: "Home of Gamers", icon: Gamepad2 },
    ],
  },
  {
    title: "AI Studio",
    links: [
      { href: "/hooks", label: "Hook Studio", icon: Lightbulb },
      { href: "/script-writer", label: "Script Writer", icon: PenLine },
      { href: "/randomizer", label: "Content Randomizer", icon: Dices },
      { href: "/caption-styler", label: "Caption Styler", icon: Captions },
      { href: "/thumbnail", label: "Thumbnail Maker", icon: Image },
      { href: "/thumbnail-maker", label: "AI Thumbnail Generator", icon: Sparkles },
      { href: "/thumbnails", label: "Thumbnail Library", icon: Images },
      { href: "/cover-art", label: "Cover Art", icon: Disc3 },
      { href: "/lyric-video", label: "Lyric Video Maker", icon: AudioWaveform },
      { href: "/voiceover", label: "Voiceover Studio", icon: Mic2 },
      { href: "/translate", label: "Translator", icon: Languages },
      { href: "/titles", label: "Title Studio", icon: Type },
    ],
  },
  {
    title: "Grow",
    links: [
      { href: "/content-calendar", label: "Content Calendar", icon: CalendarDays },
      { href: "/scheduler", label: "Scheduler", icon: Clock },
      { href: "/comment-replies", label: "Comment Replies", icon: MessageSquareReply },
      { href: "/trends", label: "Trend Predictor", icon: TrendingUp },
      { href: "/repurpose", label: "Content Repurposer", icon: Repeat },
      { href: "/sounds", label: "Sound Finder", icon: AudioWaveform },
      { href: "/channel-audit", label: "Channel Audit", icon: SearchCheck },
      { href: "/virality-check", label: "Virality Check", icon: Gauge },
      { href: "/analytics-hub", label: "Analytics Hub", icon: BarChart3 },
      { href: "/playlist-pitch", label: "Playlist Pitcher", icon: ListMusic },
      { href: "/go-live", label: "Go Live", icon: Radio },
    ],
  },
  {
    title: "Monetize",
    links: [
      { href: "/coach", label: "Monetization Coach", icon: DollarSign },
      { href: "/sponsorship-outreach", label: "Sponsorship Outreach", icon: Handshake },
      { href: "/sponsors", label: "Sponsor Marketplace", icon: Users },
      { href: "/shoutouts", label: "Fan Shoutouts", icon: Megaphone },
      { href: "/tips", label: "Tips", icon: HeartHandshake },
      { href: "/merch", label: "Merch Designer", icon: Shirt },
      { href: "/my-shop", label: "My Shop", icon: Store },
      { href: "/release-checklist", label: "Release Checklist", icon: ClipboardCheck },
      { href: "/press-kit", label: "Press Kit", icon: Newspaper },
      { href: "/email-list", label: "Email List", icon: Mail },
      { href: "/collabs", label: "Collabs", icon: UsersRound },
      { href: "/contests", label: "Contests", icon: Trophy },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/guides", label: "Guides & Services", icon: BookOpen },
      { href: "/academy", label: "Creator Academy", icon: GraduationCap },
      { href: "/copyright", label: "Copyright", icon: Copyright },
      { href: "/llc-guide", label: "LLC Guide", icon: Scale },
      { href: "/community", label: "Community", icon: UsersRound },
    ],
  },
  {
    title: "Tools",
    links: [
      { href: "/upscale", label: "Upscale & Clean", icon: Maximize },
      { href: "/watermark-removal", label: "Watermark Removal", icon: Eraser },
      { href: "/audio-cleanup", label: "Audio Cleanup", icon: Waves },
      { href: "/vocal-removal", label: "Vocal Removal", icon: MicOff },
      { href: "/stems", label: "Stem Splitter", icon: Split },
      { href: "/mastering", label: "AI Mastering", icon: SlidersHorizontal },
      { href: "/mix-master", label: "Mix & Master", icon: AudioLines },
      { href: "/sfx", label: "SFX Generator", icon: Volume2 },
      { href: "/samples", label: "Sample Packs", icon: Package },
      { href: "/logo-maker", label: "Logo Maker", icon: Palette },
      { href: "/branding-kit", label: "Branding Kit", icon: Crown },
      { href: "/intros-outros", label: "Intros & Outros", icon: PlaySquare },
      { href: "/stream-pack", label: "Stream Pack", icon: Tv },
      { href: "/thumbnail-test", label: "Thumbnail A/B Test", icon: FlaskConical },
      { href: "/podcast", label: "Podcast Studio", icon: Podcast },
    ],
  },
];

const FOOTER_LINKS: NavLink[] = [
  { href: "/pricing", label: "Pricing", icon: CreditCard },
  { href: "/credit-history", label: "Credit History", icon: Zap },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/admin", label: "Admin", icon: ShieldCheck, adminOnly: true },
];

function SidebarSection({ section, location, isAdmin }: { section: NavSection; location: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(true);
  const links = section.links.filter((l) => !l.adminOnly || isAdmin);
  if (links.length === 0) return null;
  const hasActive = links.some((l) => location === l.href);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <SidebarGroup className="p-0">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[10px] uppercase tracking-widest transition-colors hover:text-white ${
              hasActive ? "text-primary" : "text-white/30"
            }`}
          >
            <span>{section.title}</span>
            <ChevronsUpDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {links.map((link) => (
                <SidebarMenuItem key={link.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === link.href}
                    className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-primary"
                  >
                    <Link href={link.href} className="flex items-center gap-3 w-full cursor-pointer py-2">
                      <link.icon className="h-5 w-5" />
                      <span className="font-medium">{link.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, profile, signOut, getAccessToken, refreshProfile } = useAuth();
  const { setOpen } = useSidebar();
  const [isAdmin, setIsAdmin] = useState(false);
  const [addingCredits, setAddingCredits] = useState(false);

  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/admin/status", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await res.json()) as { isAdmin?: boolean };
        if (!cancelled) setIsAdmin(res.ok && data.isAdmin === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken]);

  async function handleAddTestCredits() {
    setAddingCredits(true);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/dev/add-credits", { method: "POST", headers });
      if (res.ok) await refreshProfile();
    } finally {
      setAddingCredits(false);
    }
  }

  /* Same cursor-tilt + gold-glow treatment as the header brand mark. */
  const logoTilt = useTiltOnHover<HTMLAnchorElement>({ maxDeg: 8, maxShift: 6 });

  const footerLinks = FOOTER_LINKS.filter((l) => !l.adminOnly || isAdmin);

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Link href="/" ref={logoTilt} className="flex items-center gap-2 cursor-pointer rounded-lg">
            <img
              src={`${import.meta.env.BASE_URL}logo-static.png`}
              alt="Bow Down Visuals"
              className="h-14 w-auto"
            />
          </Link>
          {/* Desktop-only: hide the sidebar for full-width content. The
              floating expand button (or Cmd/Ctrl+B) brings it back. */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            title="Hide sidebar"
            aria-label="Hide sidebar"
            data-testid="btn-collapse-sidebar"
            className="hidden md:flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary/80 transition hover:bg-primary hover:text-black"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        </div>
        {/* Simple / Advanced mode — lived in the old toolbar. */}
        {user && <ModeToggle />}
      </SidebarHeader>

      <SidebarContent className="gap-1 px-2">
        {SECTIONS.map((section) => (
          <SidebarSection key={section.title} section={section} location={location} isAdmin={isAdmin} />
        ))}

        {/* Footer links: pricing, account, admin — always visible */}
        <SidebarGroup className="p-0 mt-2 border-t border-white/[0.06] pt-2">
          <SidebarGroupContent>
            <SidebarMenu>
              {footerLinks.map((link) => (
                <SidebarMenuItem key={link.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === link.href}
                    className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-primary"
                  >
                    <Link href={link.href} className="flex items-center gap-3 w-full cursor-pointer py-2" data-tour={link.tour}>
                      <link.icon className="h-5 w-5" />
                      <span className="font-medium">{link.label}</span>
                      {link.href === "/credit-history" && profile && (
                        <span className="ml-auto text-xs font-black text-primary">
                          {profile.credits}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {user && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => window.dispatchEvent(new CustomEvent("open-help-panel"))}
                    className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full cursor-pointer"
                  >
                    <span className="flex items-center gap-3 w-full py-2">
                      <HelpCircle className="h-5 w-5" />
                      <span className="font-medium">Need Help?</span>
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-sidebar-border space-y-3">
        {user && profile ? (
          <>
            <Link
              href="/credit-history"
              title="View Credit History"
              data-tour="credits"
              className="flex items-center justify-between rounded-lg px-1 py-0.5 hover:bg-white/[0.03] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" />
                <span className="text-sm text-sidebar-foreground/70 font-medium">Credits</span>
              </div>
              <Badge variant="secondary" className="bg-primary/20 text-primary border-primary/30">
                {profile.credits} left
              </Badge>
            </Link>
            {/* Dev-only quick credits — lived in the old toolbar. */}
            {IS_DEV && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddTestCredits}
                disabled={addingCredits}
                className="w-full border-yellow-500/30 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 text-xs"
              >
                {addingCredits ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-2" />}
                Add 10 Test Credits
              </Button>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{profile.display_name ?? profile.email}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{profile.plan} plan</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-white hover:bg-sidebar-accent"
                onClick={signOut}
                data-testid="btn-logout"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : (
          <Link href="/login">
            <Button variant="outline" size="sm" className="w-full border-border text-muted-foreground hover:text-white" data-testid="btn-login-sidebar">
              <LogIn className="h-4 w-4 mr-2" /> Sign In
            </Button>
          </Link>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
