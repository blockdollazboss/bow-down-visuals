import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Library,
  Radio,
  GraduationCap,
  Shirt,
  Gem,
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
  Loader2
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";

const IS_DEV = import.meta.env.DEV;

/** Simple / Advanced mode switch — ported from the old TopBar so the
 *  toolbar's mode control lives in the sidebar now. */
function ModeToggle() {
  const { mode, setMode } = useUserMode();
  return (
    <div
      className="inline-flex w-full items-center rounded-full border border-white/[0.08] bg-white/[0.03] p-0.5"
      role="tablist"
      aria-label="Simple or Advanced mode"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "simple"}
        onClick={() => setMode("simple")}
        className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
          mode === "simple" ? "bg-primary text-black" : "text-white/45 hover:text-white"
        }`}
        title="Simple mode — one-click AI-driven creation"
      >
        <Wand2 className="h-3.5 w-3.5" /> Simple
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "advanced"}
        onClick={() => setMode("advanced")}
        className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
          mode === "advanced" ? "bg-primary text-black" : "text-white/45 hover:text-white"
        }`}
        title="Advanced mode — full manual controls"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" /> Advanced
      </button>
    </div>
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

  const links = [
    { href: "/", label: "Home", icon: Home },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/my-projects", label: "My Projects", icon: FolderOpen },
    { href: "/song-and-video", label: "Make Song + Video", icon: Mic2 },
    { href: "/make-song", label: "Make a Song", icon: Music },
    { href: "/songs", label: "Songs", icon: Music2 },
    { href: "/locations", label: "Locations", icon: MapPin },
    { href: "/make-video", label: "Make a Music Video", icon: Video },
    { href: "/video-editor", label: "Video Editor", icon: Clapperboard },
    { href: "/promo-clip", label: "Promo Clip Maker", icon: Film },
    { href: "/my-clips", label: "My Clips", icon: Library },
    { href: "/go-live", label: "Go Live", icon: Radio },
    { href: "/academy", label: "Creator Academy", icon: GraduationCap },
    { href: "/thumbnail", label: "Thumbnail Maker", icon: Image },
    { href: "/thumbnail-maker", label: "AI Thumbnail Generator", icon: Sparkles },
    { href: "/thumbnails", label: "Thumbnail Library", icon: Images },
    { href: "/merch", label: "Merch Designer", icon: Shirt },
    { href: "/jewelry", label: "Logo-to-Luxury Studio", icon: Gem },
    { href: "/playlist-pitch", label: "Playlist Pitcher", icon: ListMusic },
    { href: "/channel-audit", label: "Channel Audit", icon: SearchCheck },
    { href: "/sponsorship-outreach", label: "Sponsorship Outreach", icon: Handshake },
    { href: "/shoutouts", label: "Fan Shoutouts", icon: Megaphone },
    { href: "/release-checklist", label: "Release Checklist", icon: ClipboardCheck },
    { href: "/pricing", label: "Pricing", icon: CreditCard },
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ];

  const accountLinks = [
    { href: "/credit-history", label: "Credit History", icon: Zap },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

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

      <SidebarContent>
        <SidebarGroup>
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
        </SidebarGroup>

        {/* Account — every destination the old toolbar's user menu + mobile
            menu offered, now one tap away in the sidebar. */}
        {user && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-white/30">
              Account
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {accountLinks.map((link) => (
                  <SidebarMenuItem key={link.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === link.href}
                      className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-primary"
                    >
                      <Link href={link.href} className="flex items-center gap-3 w-full cursor-pointer py-2">
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
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-sidebar-border space-y-3">
        {user && profile ? (
          <>
            <Link
              href="/credit-history"
              title="View Credit History"
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
