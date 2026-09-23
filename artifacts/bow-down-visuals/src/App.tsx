import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/contexts/AuthContext";
import { ActiveArtistProvider } from "@/contexts/ActiveArtistContext";
import { ThemePlayerProvider } from "@/contexts/ThemePlayerContext";
import { UserModeProvider } from "@/contexts/UserModeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { BowDownAIGuide } from "@/components/BowDownAIGuide";

import { SiteFooter } from "@/components/layout/footer";

/*
 * Marketing pages are imported eagerly so they land in the initial bundle
 * (they're the ones that need to render fast for visitors and crawlers).
 * Everything else — the authenticated product and its tool pages — is
 * lazy-loaded so marketing visitors never download that code.
 */
import Home    from "@/pages/home";
import Pricing from "@/pages/pricing";
import Waitlist from "@/pages/waitlist";

const Dashboard     = lazy(() => import("@/pages/dashboard"));
const ChooseArtist  = lazy(() => import("@/pages/choose-artist"));
const MakeSong      = lazy(() => import("@/pages/make-song"));
const MakeVideo     = lazy(() => import("@/pages/make-video"));
const SongAndVideo  = lazy(() => import("@/pages/song-and-video"));
const CreateSimple  = lazy(() => import("@/pages/create-simple"));
const PromoClip     = lazy(() => import("@/pages/promo-clip"));
const Thumbnail     = lazy(() => import("@/pages/thumbnail"));
const ArtistVault   = lazy(() => import("@/pages/artist-vault"));
const MyProjects    = lazy(() => import("@/pages/my-projects"));
const VideoEditor   = lazy(() => import("@/pages/video-editor"));
const BetaAccess    = lazy(() => import("@/pages/beta-access"));
const Contact       = lazy(() => import("@/pages/contact"));
const Login         = lazy(() => import("@/pages/login"));
const Signup        = lazy(() => import("@/pages/signup"));
const NotFound      = lazy(() => import("@/pages/not-found"));
const CreditHistory = lazy(() => import("@/pages/credit-history"));
const MyClips       = lazy(() => import("@/pages/my-clips"));
const Terms         = lazy(() => import("@/pages/terms"));
const Privacy       = lazy(() => import("@/pages/privacy"));
const RefundPolicy  = lazy(() => import("@/pages/refund-policy"));

const queryClient = new QueryClient();

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location]);
  return null;
}

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function AppShell() {
  const [location] = useLocation();
  /* The video editor is a full-viewport studio surface — the marketing site
   * footer doesn't belong under it. */
  const hideFooter = location.startsWith("/video-editor");
  return (
    <>
      <ScrollToTop />
      {typeof window !== "undefined" && <BowDownAIGuide />}
      <Suspense fallback={<RouteFallback />}>
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
          <Route path="/create"><ProtectedRoute><CreateSimple /></ProtectedRoute></Route>
          <Route path="/promo-clip"><ProtectedRoute><PromoClip /></ProtectedRoute></Route>
          <Route path="/thumbnail"><ProtectedRoute><Thumbnail /></ProtectedRoute></Route>
          <Route path="/video-editor"><ProtectedRoute><VideoEditor /></ProtectedRoute></Route>
          <Route path="/credit-history"><ProtectedRoute><CreditHistory /></ProtectedRoute></Route>
          <Route path="/my-clips"><ProtectedRoute><MyClips /></ProtectedRoute></Route>

          <Route component={NotFound} />
        </Switch>
      </Suspense>
      {!hideFooter && <SiteFooter />}
    </>
  );
}

/**
 * `ssrPath` is only ever supplied by the build-time prerender entry
 * (see `entry-server.tsx`) so wouter renders the requested marketing
 * route without needing a real browser `window.location`.
 */
function App({ ssrPath }: { ssrPath?: string }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter
          base={import.meta.env.BASE_URL.replace(/\/$/, "")}
          ssrPath={ssrPath}
        >
          <ThemePlayerProvider>
            <AuthProvider>
              <UserModeProvider>
                <ActiveArtistProvider>
                  <AppShell />
                </ActiveArtistProvider>
              </UserModeProvider>
            </AuthProvider>
          </ThemePlayerProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
