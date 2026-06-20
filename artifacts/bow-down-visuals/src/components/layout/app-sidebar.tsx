import { Link, useLocation } from "wouter";
import { 
  Sidebar, 
  SidebarContent, 
  SidebarHeader, 
  SidebarGroup, 
  SidebarGroupContent,
  SidebarMenu, 
  SidebarMenuItem, 
  SidebarMenuButton, 
  SidebarFooter 
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { 
  Home, 
  LayoutDashboard, 
  Music, 
  Video, 
  Film, 
  Image, 
  CreditCard,
  Mic2
} from "lucide-react";

export function AppSidebar() {
  const [location] = useLocation();

  const links = [
    { href: "/", label: "Home", icon: Home },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/song-and-video", label: "Make Song + Video", icon: Mic2 },
    { href: "/make-song", label: "Make a Song", icon: Music },
    { href: "/make-video", label: "Make a Music Video", icon: Video },
    { href: "/promo-clip", label: "Promo Clip Maker", icon: Film },
    { href: "/thumbnail", label: "Thumbnail Maker", icon: Image },
    { href: "/pricing", label: "Pricing", icon: CreditCard },
  ];

  return (
    <Sidebar className="border-r-sidebar-border bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="p-4">
        <Link href="/" className="flex items-center gap-2 cursor-pointer">
          <div className="font-black text-xl tracking-tight text-white purple-glow-sm">
            BOW DOWN<br/>
            <span className="text-primary text-lg">VISUALS</span>
          </div>
        </Link>
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

      <SidebarFooter className="p-4 border-t border-sidebar-border">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-sidebar-foreground/70 font-medium">Credits</span>
            <Badge variant="secondary" className="bg-primary/20 text-primary border-primary/30">250 left</Badge>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
