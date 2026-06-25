import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ActiveArtistProvider } from "@/contexts/ActiveArtistContext";
import { ThemePlayerProvider } from "@/contexts/ThemePlayerContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DraggableThemePlayer } from "@/components/DraggableThemePlayer";
import { HelpPanel } from "@/components/HelpPanel";

import { SiteFooter } from "@/components/layout/footer";
import Home        from "@/pages/home";
import Dashboard   from "@/pages/dashboard";
import ChooseArtist from "@/pages/choose-artist";
import MakeSong    from "@/pages/make-song";
import MakeVideo   from "@/pages/make-video";
import SongAndVideo from "@/pages/song-and-video";
import PromoClip   from "@/pages/promo-clip";
import Thumbnail   from "@/pages/thumbnail";
import ArtistVault from "@/pages/artist-vault";
import MyProjects  from "@/pages/my-projects";
import VideoEditor from "@/pages/video-editor";
import Pricing     from "@/pages/pricing";
import Waitlist    from "@/pages/waitlist";
import BetaAccess  from "@/pages/beta-access";
import Contact     from "@/pages/contact";
import Login       from "@/pages/login";
import Signup      from "@/pages/signup";
import NotFound      from "@/pages/not-found";
import CreditHistory from "@/pages/credit-history";
import MyClips from "@/pages/my-clips";
import Terms        from "@/pages/terms";
import Privacy      from "@/pages/privacy";
import RefundPolicy from "@/pages/refund-policy";

const queryClient = new QueryClient();

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location]);
  return null;
}

function AppShell() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <ScrollToTop />
      <DraggableThemePlayer />
      <HelpPanel />
      <Switch>
        {/* Auth routes */}
        <Route path="/login"><Login /></Route>
        <Route path="/signup"><Signup /></Route>

        {/* Marketing */}
        <Route path="/"><Home /></Route>
        <Route path="/pricing"><Pricing /></Route>
        <Route path="/waitlist"><Waitlist /></Route>
        <Route path="/beta-access"><BetaAccess /></Route>
        <Route path="/contact"><Contact /></Route>
        <Route path="/terms"><Terms /></Route>
        <Route path="/privacy"><Privacy /></Route>
        <Route path="/refund-policy"><RefundPolicy /></Route>

        {/* Protected app pages */}
        <Route path="/dashboard"><ProtectedRoute><Dashboard /></ProtectedRoute></Route>
        <Route path="/choose-artist"><ProtectedRoute><ChooseArtist /></ProtectedRoute></Route>
        <Route path="/my-projects"><ProtectedRoute><MyProjects /></ProtectedRoute></Route>
        <Route path="/artist-vault"><ProtectedRoute><ArtistVault /></ProtectedRoute></Route>

        {/* Protected tool pages */}
        <Route path="/make-song"><ProtectedRoute><MakeSong /></ProtectedRoute></Route>
        <Route path="/make-video"><ProtectedRoute><MakeVideo /></ProtectedRoute></Route>
        <Route path="/song-and-video"><ProtectedRoute><SongAndVideo /></ProtectedRoute></Route>
        <Route path="/promo-clip"><ProtectedRoute><PromoClip /></ProtectedRoute></Route>
        <Route path="/thumbnail"><ProtectedRoute><Thumbnail /></ProtectedRoute></Route>
        <Route path="/video-editor"><ProtectedRoute><VideoEditor /></ProtectedRoute></Route>
        <Route path="/credit-history"><ProtectedRoute><CreditHistory /></ProtectedRoute></Route>
        <Route path="/my-clips"><ProtectedRoute><MyClips /></ProtectedRoute></Route>

        <Route component={NotFound} />
      </Switch>
      <SiteFooter />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemePlayerProvider>
          <AuthProvider>
            <ActiveArtistProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <AppShell />
              </WouterRouter>
            </ActiveArtistProvider>
          </AuthProvider>
        </ThemePlayerProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
