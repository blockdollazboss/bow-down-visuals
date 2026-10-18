import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSidebarDock } from "@/hooks/use-sidebar-dock";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
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
  Music2,
  Disc,
  Drum,
  ShoppingCart,
  Wallet,
  Film,
  Clapperboard,
  Image,
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
  Captions,
  Disc3,
  BookOpen,
  AudioWaveform,
  Languages,
  Type,
  CalendarDays,
  Clock,
  MessageSquareReply,
  MessageCircle,
  Compass,
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
  Podcast,
  Gamepad2,
  Swords,
  Gem,
  Gift,
  Puzzle,
  Star,
  BarChart3,
  Crown,
  Rocket,
  LayoutGrid,
  type LucideIcon,

} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { STAR_RANKS, STAR_TAGLINES } from "@/lib/creator-level";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { BowTestLogo } from "@/components/BowTestLogo";
import { ThemedLogo } from "@/components/ThemedLogo";
import { SHORTS_NAV_ENTRY } from "@/lib/shorts-navigation";

const IS_DEV = import.meta.env.DEV;

/** Creator Rank display — stars are EARNED (server-computed from
 *  recorded work; see lib/creator-rank.ts on the API). This is a
 *  display, not a dial: there is nothing to tap to change your rank.
 *  It shows the earned stars, the rank name, progress toward the next
 *  star, and what earns it — the next thing, named. */
function ModeToggle() {
  const { stars, rank } = useUserMode();
  const next = rank?.next ?? null;
  const progressPct =
    rank == null
      ? 0
      : next == null
        ? 100
        : Math.min(100, Math.round((rank.points / Math.max(1, next.pointsAt)) * 100));
  return (
    <div className="w-full space-y-1.5" aria-label="Creator rank">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">
          Creator Rank
        </span>
        <span className="text-[10px] font-black text-primary uppercase">
          {STAR_RANKS[stars - 1]}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1 px-0.5" aria-label={`${stars} of 6 stars earned`}>
        {([1, 2, 3, 4, 5, 6] as const).map((s) => (
          <Star
            key={s}
            className={`h-5 w-5 ${
              s <= stars
                ? "fill-primary text-primary drop-shadow-[0_0_6px_rgba(201,168,76,0.8)]"
                : "fill-transparent text-white/20"
            }`}
          />
        ))}
      </div>
      {rank != null && next != null && (
        <>
          <div
            className="mx-0.5 h-1 rounded-full bg-white/10 overflow-hidden"
            role="progressbar"
            aria-valuenow={rank.points}
            aria-valuemax={next.pointsAt}
            aria-label={`${rank.points} of ${next.pointsAt} points toward ${next.stars} stars`}
          >
            <div className="h-full bg-primary" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="text-[10px] text-white/35 px-0.5">
            {rank.points} pts · {next.pointsNeeded} to {STAR_RANKS[next.stars - 1]}
          </p>
          {rank.hints.slice(0, 2).map((hint) => (
            <p key={hint} className="text-[10px] text-white/35 px-0.5">
              {hint}
            </p>
          ))}
        </>
      )}
      {rank != null && next == null && (
        <p className="text-[10px] text-white/35 px-0.5">
          {rank.points} pts · top rank — every star earned.
        </p>
      )}
      {rank == null && (
        <p className="text-[10px] text-white/35 px-0.5">{STAR_TAGLINES[stars - 1]}</p>
      )}
    </div>
  );
}

interface NavLink {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  tour?: string;
  badge?: string;
}

interface NavSection {
  titleKey: string;
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

/* ── Grouped navigation: 19 hub entries. Every former standalone page lives
   as a tab inside its hub; old URLs redirect (see App.tsx). ── */
const SECTIONS: NavSection[] = [
  {
    /* My Studio — the creator's house (blueprint Phase 1, 2026-10-13):
       home base first, then the flow Create → Brand → Promote → Social →
       Get Paid. My Projects / Vault / Library moved out of Create. */
    titleKey: "nav.myStudio",
    links: [
      { href: "/", labelKey: "nav.home", icon: Home },
      { href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
      { href: "/my-projects", labelKey: "nav.myProjects", icon: FolderOpen },
      { href: "/artist-vault", labelKey: "nav.creatorVault", icon: ShieldCheck },
      { href: "/library", labelKey: "nav.library", icon: Library },
      { href: "/extension", labelKey: "nav.chromeExtension", icon: Puzzle, badge: "NEW" },
    ],
  },
  {
    titleKey: "nav.create",
    links: [
      { href: "/create", labelKey: "nav.create", icon: Layers },
      { href: "/video-editor", labelKey: "nav.videoEditor", icon: Clapperboard },
      { href: "/audio-studio", labelKey: "nav.audioStudio", icon: AudioWaveform },
      { href: "/hooks", labelKey: "nav.hookStudio", icon: Lightbulb },
      { href: "/thumbnail-studio", labelKey: "nav.thumbnailStudio", icon: Sparkles },
      { href: "/books", labelKey: "nav.thyBooks", icon: BookOpen },
    ],
  },
  {
    /* Branding gets its own home (was filed under Monetize). Phase 2
       de-hosted Storefronts and My Shop out of the Coach into here. */
    titleKey: "nav.branding",
    links: [
      { href: "/branding-kit", labelKey: "nav.brandingKit", icon: Crown },
      { href: "/storefronts", labelKey: "nav.storefronts", icon: Store },
      { href: "/my-shop", labelKey: "nav.myShop", icon: ShoppingBag },
    ],
  },
  {
    titleKey: "nav.promote",
    links: [
      { href: "/promote", labelKey: "nav.promote", icon: Megaphone },
      { href: "/referrals", labelKey: "nav.referrals", icon: Gift },
      { href: "/scheduler", labelKey: "nav.scheduler", icon: Clock },
      { href: "/go-live", labelKey: "nav.goLive", icon: Radio },
      { href: "/press-kit", labelKey: "nav.pressKit", icon: Newspaper },
      { href: "/email-list", labelKey: "nav.emailList", icon: Mail },
    ],
  },
  {
    /* The social area — unburied 2026-10-12 (owner directive); renamed to
       Social in the Phase-1 six-area map. Feed is the front door (/home,
       the creator timeline); Thy Cheat Code is every member's first friend. */
    titleKey: "nav.social",
    links: [
      { href: "/home", labelKey: "nav.feed", icon: Newspaper },
      { href: SHORTS_NAV_ENTRY.href, labelKey: SHORTS_NAV_ENTRY.labelKey, icon: Clapperboard },
      { href: "/explore", labelKey: "nav.explore", icon: Compass },
      { href: "/groups", labelKey: "nav.groups", icon: Users },
      { href: "/events", labelKey: "nav.events", icon: CalendarDays },
      { href: "/messages", labelKey: "nav.messages", icon: MessageCircle },
      { href: "/collabs", labelKey: "nav.collabs", icon: UsersRound },
      { href: "/contests", labelKey: "nav.contests", icon: Trophy },
      { href: "/arcade", labelKey: "nav.arcade", icon: Gamepad2, badge: "NEW" },
      { href: "/party", labelKey: "nav.partyGames", icon: Swords, badge: "NEW" },
      { href: "/winners", labelKey: "nav.winnersCircle", icon: Crown },
    ],
  },
  {
    titleKey: "nav.getPaid",
    links: [
      { href: "/coach", labelKey: "nav.monetizationCoach", icon: DollarSign },
      { href: "/brand-deals", labelKey: "nav.brandDeals", icon: Handshake },
      { href: "/distribute", labelKey: "nav.distributeMusic", icon: Rocket },
      { href: "/analytics-hub", labelKey: "nav.analyticsHub", icon: BarChart3 },
      { href: "/academy", labelKey: "nav.creatorAcademy", icon: GraduationCap },
    ],
  },
];

const FOOTER_LINKS: NavLink[] = [
  { href: "/pricing", labelKey: "nav.pricing", icon: CreditCard },
  { href: "/credit-history", labelKey: "nav.visualBucHistory", icon: Zap },
  { href: "/settings", labelKey: "nav.settings", icon: Settings },
  { href: "/admin", labelKey: "nav.admin", icon: ShieldCheck, adminOnly: true },
];

function SidebarSection({ section, location, isAdmin }: { section: NavSection; location: string; isAdmin: boolean }) {
  const { t } = useTranslation();
  // Persist collapsed state per section so it survives remounts/navigation.
  // Defaults to open; auto-opens when the section contains the active page.
  const storageKey = `bdv-sidebar-${section.titleKey}`;
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) return saved === "1";
    } catch {}
    return true;
  });
  const links = section.links.filter((l) => !l.adminOnly || isAdmin);
  if (links.length === 0) return null;
  const hasActive = links.some((l) => location === l.href);
  // If the active page is in a collapsed section, auto-expand it.
  useEffect(() => {
    if (hasActive && !open) {
      setOpen(true);
      try { localStorage.setItem(storageKey, "1"); } catch {}
    }
  }, [hasActive]);

  function handleOpenChange(v: boolean) {
    setOpen(v);
    try { localStorage.setItem(storageKey, v ? "1" : "0"); } catch {}
  }

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <SidebarGroup className="p-0">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[10px] uppercase tracking-widest transition-colors hover:text-white ${
              hasActive ? "text-primary" : "text-white/30"
            }`}
          >
            <span>{t(section.titleKey)}</span>
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
                      <span className="font-medium">{t(link.labelKey)}</span>
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
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
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
              <ThemedLogo className="h-8 w-auto" />
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
              <ThemedLogo className="h-14 w-auto" />
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
              className={`w-full rounded-lg border pl-9 pr-3 py-2 text-sm outline-none focus:border-primary/50 ${isLight ? "bg-white border-[#C9A84C]/40 text-[#2A1E07] placeholder:text-[#6B5B36]/50" : "bg-[#171208]/40 border-white/10 text-white placeholder:text-white/30"}`}
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
          <div className="pointer-events-auto" onPointerDown={(e) => e.stopPropagation()}>
            <ThemeToggle />
          </div>
        </SidebarHeader>

      <SidebarContent className="gap-1 px-2">
        {(searchQuery.trim()
          ? SECTIONS.map((section) => ({
              ...section,
              links: section.links.filter((link) =>
                t(link.labelKey).toLowerCase().includes(searchQuery.trim().toLowerCase())
              ),
            })).filter((section) => section.links.length > 0)
          : SECTIONS
        ).map((section) => (
          <SidebarSection key={section.titleKey} section={section} location={location} isAdmin={isAdmin} />
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
                      <span className="font-medium">{t(link.labelKey)}</span>
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
                <p className="text-xs font-semibold text-white truncate">{profile.display_name ?? "Creator"}</p>
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
  const { t } = useTranslation();
  const [location] = useLocation();
  const mainSections = [
    { titleKey: "nav.home", href: "/", icon: Home },
    { titleKey: "nav.myStudio", href: "/dashboard", icon: LayoutDashboard },
    { titleKey: "nav.create", href: "/create", icon: Layers },
    { titleKey: "nav.branding", href: "/branding-kit", icon: Crown },
    { titleKey: "nav.promote", href: "/promote", icon: Megaphone },
    { titleKey: "nav.social", href: "/home", icon: Newspaper },
    { titleKey: SHORTS_NAV_ENTRY.labelKey, href: SHORTS_NAV_ENTRY.href, icon: Clapperboard },
    { titleKey: "nav.getPaid", href: "/coach", icon: DollarSign },
  ];
  return (
    <>
      {mainSections.map((section) => {
        const Icon = section.icon;
        const isActive = location === section.href;
        return (
          <Link key={section.titleKey} href={section.href} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}>
            <Icon className="h-4 w-4" />
            <span className="hidden md:inline">{t(section.titleKey)}</span>
          </Link>
        );
      })}
    </>
  );
}
