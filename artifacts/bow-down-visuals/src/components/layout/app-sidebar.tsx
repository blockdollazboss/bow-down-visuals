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
  BookOpen
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";

export function AppSidebar() {
  const [location] = useLocation();
  const { user, profile, signOut, getAccessToken } = useAuth();
  const { setOpen } = useSidebar();
  const [isAdmin, setIsAdmin] = useState(false);

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

  /* Same cursor-tilt + gold-glow treatment as the header brand mark. */
  const logoTilt = useTiltOnHover<HTMLAnchorElement>({ maxDeg: 8, maxShift: 6 });

  const links = [
    { href: "/", label: "Home", icon: Home },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
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
    { href: "/guides", label: "Guides & Services", icon: BookOpen },
    { href: "/thumbnail", label: "Thumbnail Maker", icon: Image },
    { href: "/thumbnail-maker", label: "AI Thumbnail Generator", icon: Sparkles },
    { href: "/thumbnails", label: "Thumbnail Library", icon: Images },
    { href: "/pricing", label: "Pricing", icon: CreditCard },
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ];

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="p-4">
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
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-sidebar-border space-y-3">
        {user && profile ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" />
                <span className="text-sm text-sidebar-foreground/70 font-medium">Credits</span>
              </div>
              <Badge variant="secondary" className="bg-primary/20 text-primary border-primary/30">
                {profile.credits} left
              </Badge>
            </div>
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
