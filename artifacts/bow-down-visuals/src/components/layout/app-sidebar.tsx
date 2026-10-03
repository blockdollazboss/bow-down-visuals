import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useSidebarDock } from "@/hooks/use-sidebar-dock";
import { useExtensionPromoVisible } from "@/lib/extension-promo";
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
import { VisualBucsIcon } from "@/components/VisualBucsIcon";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Home,
  LayoutDashboard,
  Layers,
  Music,
  Music2,
  Disc,
  Drum,
  ShoppingCart,
  Wallet,
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
  ShieldCheck,
  Lock,
  MapPin,
  ChevronsLeft,
  ChevronsUpDown,
  Library,
  Radio,
  Bot,
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
  Search,
  MousePointer2,
  SlidersHorizontal,
  Plus,
  Loader2,
  Scissors,
  Lightbulb,
  PenLine,
  Dices,
  Captions,
  Disc3,
  BookOpen,
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
  ShoppingBag,
  Store,
  Newspaper,
  Mail,
  Users,
  Trophy,
  Ticket,
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
  Gift,
  Puzzle,
  Star,
  Gauge,
  BarChart3,
  Crown,
  Rocket,
  type LucideIcon,

} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { STAR_RANKS, STAR_TAGLINES } from "@/lib/creator-level";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { BowTestLogo } from "@/components/BowTestLogo";

const IS_DEV = import.meta.env.DEV;

/** Simple / Advanced mode switch — ported from the old TopBar so the
 *  toolbar's mode control lives in the sidebar now. */
function ModeToggle() {
  const { stars, maxStars, setStars } = useUserMode();
  return (
    <div className="w-full space-y-1.5" role="radiogroup" aria-label="Creator level">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">
          Creator Level
        </span>
        <span className="text-[10px] font-black text-primary uppercase">
          {STAR_RANKS[stars - 1]}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1">
        {([1, 2, 3, 4, 5, 6] as const).map((s) => {
          const active = s <= stars;
          const locked = s > maxStars;
          const starIcon = (
            <Star
              className={`h-5 w-5 transition-colors ${
                active
                  ? "fill-primary text-primary drop-shadow-[0_0_6px_rgba(201,168,76,0.8)]"
                  : "fill-transparent text-white/20 hover:text-white/40"
              }`}
            />
          );
          if (locked) {
            return (
              <Link
                key={s}
                href="/pricing"
                aria-label={`${s} stars — ${STAR_RANKS[s - 1]} — locked, requires ${STAR_RANKS[s - 1]} plan`}
                title={`Locked — requires the ${STAR_RANKS[s - 1]} plan. Tap to see plans.`}
                className="flex-1 flex justify-center items-center gap-0.5 py-1 opacity-50 hover:opacity-90 transition-opacity"
              >
                {starIcon}
                <Lock className="h-3 w-3 text-white/40" />
              </Link>
            );
          }
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={stars === s}
              aria-label={`${s} star${s > 1 ? "s" : ""} — ${STAR_RANKS[s - 1]}`}
              onClick={() => setStars(s)}
              className="flex-1 flex justify-center py-1 transition-transform hover:scale-125 active:scale-95"
              title={`${STAR_RANKS[s - 1]} — ${STAR_TAGLINES[s - 1]}`}
            >
              {starIcon}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-white/35 px-0.5">
        {STAR_TAGLINES[stars - 1]}
      </p>
      {maxStars < 6 && (
        <p className="text-[10px] text-white/35 px-0.5">
          <Link href="/pricing" className="underline underline-offset-2 hover:text-white/60">
            Upgrade your plan
          </Link>{" "}
          to unlock more stars.
        </p>
      )}
    </div>
  );
}

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  tour?: string;
  badge?: string;
}

interface NavSection {
  title: string;
  links: NavLink[];
}

/* NEW badge for nav items — hidden once the visitor downloads the extension. */
function NavItemBadge({ text }: { text: string }) {
  const show = useExtensionPromoVisible();
  if (!show) return null;
  return (
    <span className="ml-auto rounded-full bg-gradient-to-r from-[#C9A84C] to-[#e8c86a] px-2 py-0.5 text-[10px] font-bold text-black">
      {text}
    </span>
  );
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
      { href: "/hub", label: "Creation Hub", icon: Layers },
      { href: "/song-and-video", label: "Start from Scratch", icon: Mic2 },
      { href: "/make-song", label: "Make a Song", icon: Music },
      { href: "/beat-maker", label: "Beat Maker", icon: Drum },
      { href: "/make-video", label: "Video for My Song", icon: Video },
      { href: "/video-editor", label: "Video Editor", icon: Clapperboard },
      { href: "/promo-clip", label: "Promo Clip Maker", icon: Film },
      { href: "/clip-maker", label: "AI Streamer Clips", icon: Scissors },
      { href: "/create", label: "Quick Create", icon: Zap },
      { href: "/my-projects", label: "My Projects", icon: FolderOpen },
      { href: "/my-clips", label: "My Clips", icon: Library },
      { href: "/songs", label: "Songs", icon: Music2 },
      { href: "/artist-vault", label: "Creator Vault", icon: ShieldCheck },
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
      { href: "/shows", label: "Show Finder", icon: Ticket },
      { href: "/discord-bot", label: "Discord Bot", icon: Bot },
    ],
  },
  {
    title: "Monetize",
    links: [
      { href: "/distribute", label: "Distribute Music", icon: Rocket },
      { href: "/coach", label: "Monetization Coach", icon: DollarSign },
      { href: "/sponsorship-outreach", label: "Sponsorship Outreach", icon: Handshake },
      { href: "/brand-deals", label: "Brand Deal Finder", icon: Handshake },
      { href: "/sponsors", label: "Sponsor Marketplace", icon: Users },
      { href: "/shoutouts", label: "Fan Shoutouts", icon: Megaphone },
      { href: "/tips", label: "Tips", icon: HeartHandshake },
      { href: "/merch", label: "Merch Designer", icon: Shirt },
      { href: "/branding-shop", label: "Branding Shop", icon: Store },
      { href: "/beats", label: "Beats Marketplace", icon: Disc },
      { href: "/live-shopping", label: "Live Shopping", icon: ShoppingCart },
      { href: "/memberships", label: "Memberships", icon: Star },
      { href: "/royalties", label: "Royalties", icon: Wallet },
      { href: "/storefronts", label: "Storefronts", icon: ShoppingBag },
      { href: "/my-shop", label: "My Shop", icon: Store },
      { href: "/release-checklist", label: "Release Checklist", icon: ClipboardCheck },
      { href: "/press-kit", label: "Press Kit", icon: Newspaper },
      { href: "/email-list", label: "Email List", icon: Mail },
      { href: "/collabs", label: "Collabs", icon: UsersRound },
      { href: "/contests", label: "Contests", icon: Trophy },
      { href: "/referrals", label: "Referrals", icon: Gift },
      { href: "/team", label: "Team", icon: Users },
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
      { href: "/extension", label: "Chrome Extension", icon: Puzzle, badge: "NEW" },
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
  { href: "/credit-history", label: "Visual Buc History", icon: Zap },
  { href: "/cursor-lab", label: "Cursor Style", icon: MousePointer2 },
  { href: "/settings", label: "Settings", icon: Settings },
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
                      {link.badge && <NavItemBadge text={link.badge} />}
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
  const [searchQuery, setSearchQuery] = useState("");
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

  /* Sidebar docking — drag the header to dock to any of 4 edges.
     Docking only changes the DESKTOP layout. The mobile drawer (<Sidebar>
     below) is always mounted — otherwise docking top/bottom unmounts the
     Sheet and the mobile hamburger opens nothing. */
  const { docked, isDragging, dragPos, onPointerDown } = useSidebarDock();
  const isHorizontal = docked === "top" || docked === "bottom";
  const sidebarSide: "left" | "right" = docked === "right" ? "right" : "left";

  return (
    <>
      {/* Top/bottom dock: horizontal nav bar — desktop only. On mobile the
          drawer is the navigation; the bar would just eat screen space. */}
      {isHorizontal && (
        <div
          onPointerDown={onPointerDown}
          className={`hidden md:block fixed left-0 right-0 z-50 h-16 bg-sidebar border-sidebar-border cursor-grab active:cursor-grabbing select-none ${
            docked === "top" ? "top-0 border-b" : "bottom-0 border-t"
          }`}
          title="Drag to move sidebar to any edge"
        >
          <div className="h-full w-full flex items-center px-4 gap-2 overflow-x-auto">
            <Link href="/" className="flex items-center gap-2 mr-4 shrink-0 pointer-events-none">
              <img
                src={`${import.meta.env.BASE_URL}logo-static.png`}
                alt="Bow Down Visuals"
                className="h-8 w-auto"
              />
            </Link>
            <HorizontalSidebarNav />
          </div>
        </div>
      )}

      {/* Vertical sidebar with draggable header. When docked top/bottom the
          desktop rail is hidden via the wrapper, but the <Sidebar> stays
          mounted so the mobile Sheet drawer always works (it portals, so
          the wrapper never hides it). */}
      <div className={isHorizontal ? "md:hidden" : "contents"}>
      <Sidebar
        side={sidebarSide}
        className="border-sidebar-border bg-sidebar text-sidebar-foreground"
      >
        <SidebarHeader 
          className="p-4 space-y-3 cursor-grab active:cursor-grabbing select-none"
          onPointerDown={onPointerDown}
          title="Drag to move sidebar to any edge"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 rounded-lg">
              <img
                src={`${import.meta.env.BASE_URL}logo-static.png`}
                alt="Bow Down Visuals"
                className="h-14 w-auto"
              />
            </div>
            <button type="button" onClick={() => setOpen(false)} onPointerDown={(e) => e.stopPropagation()} title="Hide sidebar" aria-label="Hide sidebar" data-testid="btn-collapse-sidebar" className="hidden md:flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary/80 transition hover:bg-primary hover:text-black">
              <ChevronsLeft className={`h-4 w-4 ${docked === "right" ? "rotate-180" : ""}`} />
            </button>
          </div>
          <div className="relative pointer-events-auto" onPointerDown={(e) => e.stopPropagation()}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <input
              type="text"
              placeholder="Search pages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg bg-black/40 border border-white/10 pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-primary/50"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-lg leading-none"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          {user && <div className="pointer-events-auto"><ModeToggle /></div>}
        </SidebarHeader>

      <SidebarContent className="gap-1 px-2">
        {(searchQuery.trim()
          ? SECTIONS.map((section) => ({
              ...section,
              links: section.links.filter((link) =>
                link.label.toLowerCase().includes(searchQuery.trim().toLowerCase())
              ),
            })).filter((section) => section.links.length > 0)
          : SECTIONS
        ).map((section) => (
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
                          {profile.credits.toLocaleString("en-US")}
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
              title="View Visual Buc History"
              data-tour="credits"
              className="flex items-center justify-between rounded-lg px-1 py-0.5 hover:bg-white/[0.03] transition-colors"
            >
              <div className="flex items-center gap-2">
                <VisualBucsIcon className="h-4 w-4" />
                <span className="text-sm text-sidebar-foreground/70 font-medium">Visual Bucs</span>
              </div>
              <Badge variant="secondary" className="bg-primary/20 text-primary border-primary/30">
                {profile.credits.toLocaleString("en-US")} left
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
                Add 10 Test Visual Bucs
              </Button>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{profile.display_name ?? profile.email}</p>
                <Link
                  href="/pricing"
                  title="View ranks"
                  className="flex items-center gap-1.5 mt-0.5 group/rank"
                >
                  <span className="text-[10px] text-primary font-black tracking-wider group-hover/rank:underline">
                    ★ {profile.plan === "beta" || !profile.plan ? "BETA TESTER" : `${profile.plan} plan`}
                  </span>
                  <span className="text-[9px] text-muted-foreground group-hover/rank:text-primary transition-colors">
                    Rank up →
                  </span>
                </Link>
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
              {/* Secret Global Bow Race: signed-in users' bows feed the
                  monthly race. Silent by design — just a shark that bows. */}
              <div title="Click me — I bow">
                <BowTestLogo compact />
              </div>
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
      </div>
      {isDragging && dragPos && <DockIndicator x={dragPos.x} y={dragPos.y} />}
    </>
  );
}

/** Visual indicator showing which edge the sidebar will dock to */
function DockIndicator({ x, y }: { x: number; y: number }) {
  const w = typeof window !== "undefined" ? window.innerWidth : 1000;
  const h = typeof window !== "undefined" ? window.innerHeight : 800;
  const min = Math.min(x, w - x, y, h - y);
  const label = min === x ? "Left" : min === w - x ? "Right" : min === y ? "Top" : "Bottom";
  return (
    <div className="fixed z-[70] pointer-events-none" style={{ left: x - 100, top: y - 20, width: 200, height: 40 }}>
      <div className="w-full h-full rounded-lg border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center">
        <span className="text-xs font-bold text-primary">Dock to: {label}</span>
      </div>
    </div>
  );
}

/** Horizontal navigation for top/bottom docked sidebar */
function HorizontalSidebarNav() {
  const [location] = useLocation();
  const mainSections = [
    { title: "Home", href: "/", icon: Home },
    { title: "Create", href: "/hub", icon: Layers },
    { title: "AI Studio", href: "/hooks", icon: Sparkles },
    { title: "Grow", href: "/content-calendar", icon: TrendingUp },
    { title: "Monetize", href: "/pricing", icon: DollarSign },
    { title: "Learn", href: "/academy", icon: GraduationCap },
    { title: "Tools", href: "/settings", icon: Settings },
  ];
  return (
    <>
      {mainSections.map((section) => {
        const Icon = section.icon;
        const isActive = location === section.href;
        return (
          <Link key={section.title} href={section.href} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}>
            <Icon className="h-4 w-4" />
            <span className="hidden md:inline">{section.title}</span>
          </Link>
        );
      })}
    </>
  );
}
