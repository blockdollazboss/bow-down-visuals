import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/contexts/AuthContext";
import { ActiveArtistProvider } from "@/contexts/ActiveArtistContext";
import { ThemePlayerProvider } from "@/contexts/ThemePlayerContext";
import { UserModeProvider } from "@/contexts/UserModeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { BowDownAIGuide } from "@/components/BowDownAIGuide";
import { AiChatWidget } from "@/components/AiChatWidget";
import { HelpPanel } from "@/components/HelpPanel";

import { SiteFooter } from "@/components/layout/footer";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ExpandSidebarButton } from "@/components/layout/expand-sidebar-button";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";

/*
 * Marketing pages are imported eagerly so they land in the initial bundle
 * (they're the ones that need to render fast for visitors and crawlers).
 * Everything else — the authenticated product and its tool pages — is
 * lazy-loaded so marketing visitors never download that code.
 */
import Home    from "@/pages/home";
import Pricing from "@/pages/pricing";
import Waitlist from "@/pages/waitlist";

const Dashboard     = lazyWithRetry(() => import("@/pages/dashboard"));
const ChooseArtist  = lazyWithRetry(() => import("@/pages/choose-artist"));
const MakeSong      = lazyWithRetry(() => import("@/pages/make-song"));
const MakeVideo     = lazyWithRetry(() => import("@/pages/make-video"));
const SongAndVideo  = lazyWithRetry(() => import("@/pages/song-and-video"));
const CreateSimple  = lazyWithRetry(() => import("@/pages/create-simple"));
const PromoClip     = lazyWithRetry(() => import("@/pages/promo-clip"));
const Thumbnail     = lazyWithRetry(() => import("@/pages/thumbnail"));
const Thumbnails    = lazyWithRetry(() => import("@/pages/thumbnails"));
const ArtistVault   = lazyWithRetry(() => import("@/pages/artist-vault"));
const MyProjects    = lazyWithRetry(() => import("@/pages/my-projects"));
const VideoEditor   = lazyWithRetry(() => import("@/pages/video-editor"));
const BetaAccess    = lazyWithRetry(() => import("@/pages/beta-access"));
const Contact       = lazyWithRetry(() => import("@/pages/contact"));
const Login         = lazyWithRetry(() => import("@/pages/login"));
const Signup        = lazyWithRetry(() => import("@/pages/signup"));
const NotFound      = lazyWithRetry(() => import("@/pages/not-found"));
const CreditHistory = lazyWithRetry(() => import("@/pages/credit-history"));
const MyClips       = lazyWithRetry(() => import("@/pages/my-clips"));
const Admin         = lazyWithRetry(() => import("@/pages/admin"));
const Songs         = lazyWithRetry(() => import("@/pages/songs"));
const Locations     = lazyWithRetry(() => import("@/pages/locations"));
const Terms         = lazyWithRetry(() => import("@/pages/terms"));
const Privacy       = lazyWithRetry(() => import("@/pages/privacy"));
const RefundPolicy  = lazyWithRetry(() => import("@/pages/refund-policy"));
const Randomizer    = lazyWithRetry(() => import("@/pages/randomizer"));
const HookStudio    = lazyWithRetry(() => import("@/pages/hooks"));
const ChannelAudit  = lazyWithRetry(() => import("@/pages/audit"));
const CommentReplies = lazyWithRetry(() => import("@/pages/comment-replies"));
const TitleStudio   = lazyWithRetry(() => import("@/pages/titles"));
const MonetizationCoach = lazyWithRetry(() => import("@/pages/coach"));
const CreatorAcademy = lazyWithRetry(() => import("@/pages/academy"));
const ContentCalendar = lazyWithRetry(() => import("@/pages/content-calendar"));
const CommunityManager = lazyWithRetry(() => import("@/pages/community"));
const Upscale = lazyWithRetry(() => import("@/pages/upscale"));
const WatermarkRemoval = lazyWithRetry(() => import("@/pages/watermark-removal"));
const Mastering = lazyWithRetry(() => import("@/pages/mastering"));
const LogoMaker = lazyWithRetry(() => import("@/pages/logo-maker"));
const IntrosOutros = lazyWithRetry(() => import("@/pages/intros-outros"));
const StreamPack = lazyWithRetry(() => import("@/pages/stream-pack"));
const CopyrightAssistant = lazyWithRetry(() => import("@/pages/copyright"));
const LlcGuide = lazyWithRetry(() => import("@/pages/llc-guide"));
const ScriptWriter = lazyWithRetry(() => import("@/pages/script-writer"));
const Beats = lazyWithRetry(() => import("@/pages/beats"));
const BrandingShop = lazyWithRetry(() => import("@/pages/branding-shop"));
const CaptionStyler = lazyWithRetry(() => import("@/pages/caption-styler"));
const CollabFinder = lazyWithRetry(() => import("@/pages/collabs"));
const Repurpose = lazyWithRetry(() => import("@/pages/repurpose"));
const Settings = lazyWithRetry(() => import("@/pages/settings"));

/**
 * lazy() with a retry for chunk-load failures.
 *
 * A route chunk can fail to load for transient reasons (network blip) or
 * because a fresh deploy replaced the hashed chunk files (deploy skew) while
 * this tab still references the old names. Without a retry, the rejected
 * import unmounts the whole app into a dead blank page and only a manual
 * reload recovers. So: wait a beat and retry once; if the chunk is still
 * unreachable, do a full reload — that fetches a fresh index.html with the
 * current chunk hashes, which is exactly the manual recovery, automated.
 */
function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await importer();
    } catch (firstError) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        return await importer();
      } catch {
        window.location.reload();
        throw firstError;
      }
    }
  });
}

/**
 * Catches render errors anywhere inside the routed page (including a chunk
 * that failed even after retry) and shows a one-click recovery instead of
 * unmounting the app into a dead blank page. Keyed by location so navigating
 * to another route clears a previous failure.
 */
class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RouteErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center px-6 py-16">
          <div className="max-w-sm text-center space-y-4">
            <p className="text-white/80 font-semibold">
              This page didn't load properly.
            </p>
            <p className="text-white/40 text-sm leading-relaxed">
              Nothing was lost — reloading usually fixes it right away.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary text-black hover:brightness-110 transition"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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

/**
 * Authenticated app layout: persistent sidebar navigation (with the
 * admin-only Admin link) beside the page content. The sidebar is
 * collapsible on desktop — the collapsed choice persists in localStorage —
 * and a floating expand button guarantees the user can always bring it
 * back. On mobile the sidebar renders as a drawer (unchanged).
 * The video editor keeps its full-viewport studio surface and stays
 * outside this layout.
 */
function AuthedLayout({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapsed();
  return (
    <SidebarProvider
      open={!sidebarCollapsed}
      onOpenChange={(open) => setSidebarCollapsed(!open)}
    >
      <div className="flex min-h-svh w-full">
        <AppSidebar />
        <main className="min-w-0 flex-1">{children}</main>
        <ExpandSidebarButton
          collapsed={sidebarCollapsed}
          onExpand={() => setSidebarCollapsed(false)}
        />
      </div>
    </SidebarProvider>
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
      {typeof window !== "undefined" && <AiChatWidget />}
      {typeof window !== "undefined" && <HelpPanel />}
      <Suspense fallback={<RouteFallback />}>
        <RouteErrorBoundary key={location}>
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
          <Route path="/randomizer"><Randomizer /></Route>
          <Route path="/hooks"><HookStudio /></Route>
          <Route path="/audit"><ChannelAudit /></Route>
          <Route path="/comment-replies"><CommentReplies /></Route>
          <Route path="/titles"><TitleStudio /></Route>
          <Route path="/coach"><MonetizationCoach /></Route>
          <Route path="/academy"><CreatorAcademy /></Route>
          <Route path="/content-calendar"><ContentCalendar /></Route>
          <Route path="/community"><CommunityManager /></Route>
          <Route path="/upscale"><Upscale /></Route>
          <Route path="/watermark-removal"><WatermarkRemoval /></Route>
          <Route path="/mastering"><Mastering /></Route>
          <Route path="/logo-maker"><LogoMaker /></Route>
          <Route path="/intros-outros"><IntrosOutros /></Route>
          <Route path="/stream-pack"><StreamPack /></Route>
          <Route path="/copyright"><CopyrightAssistant /></Route>
          <Route path="/llc-guide"><LlcGuide /></Route>
          <Route path="/script-writer"><ScriptWriter /></Route>
          <Route path="/beats"><Beats /></Route>
          <Route path="/branding-shop"><BrandingShop /></Route>
          <Route path="/caption-styler"><CaptionStyler /></Route>
          <Route path="/collabs"><CollabFinder /></Route>
          {/* Protected app pages — inside the sidebar layout */}
          {/* The video editor keeps its full-viewport studio surface. */}
          <Route path="/video-editor"><ProtectedRoute><VideoEditor /></ProtectedRoute></Route>
          <Route>
            <AuthedLayout>
              <Switch>
                <Route path="/dashboard"><ProtectedRoute><Dashboard /></ProtectedRoute></Route>
                <Route path="/choose-artist"><ProtectedRoute><ChooseArtist /></ProtectedRoute></Route>
                <Route path="/my-projects"><ProtectedRoute><MyProjects /></ProtectedRoute></Route>
                <Route path="/artist-vault"><ProtectedRoute><ArtistVault /></ProtectedRoute></Route>
                <Route path="/make-song"><ProtectedRoute><MakeSong /></ProtectedRoute></Route>
                <Route path="/make-video"><ProtectedRoute><MakeVideo /></ProtectedRoute></Route>
                <Route path="/song-and-video"><ProtectedRoute><SongAndVideo /></ProtectedRoute></Route>
                <Route path="/create"><ProtectedRoute><CreateSimple /></ProtectedRoute></Route>
                <Route path="/promo-clip"><ProtectedRoute><PromoClip /></ProtectedRoute></Route>
                <Route path="/thumbnail"><ProtectedRoute><Thumbnail /></ProtectedRoute></Route>
                <Route path="/thumbnails"><ProtectedRoute><Thumbnails /></ProtectedRoute></Route>
                <Route path="/credit-history"><ProtectedRoute><CreditHistory /></ProtectedRoute></Route>
                <Route path="/settings"><ProtectedRoute><Settings /></ProtectedRoute></Route>
                <Route path="/my-clips"><ProtectedRoute><MyClips /></ProtectedRoute></Route>
                <Route path="/admin"><ProtectedRoute><Admin /></ProtectedRoute></Route>
                <Route path="/songs"><ProtectedRoute><Songs /></ProtectedRoute></Route>
                <Route path="/locations"><ProtectedRoute><Locations /></ProtectedRoute></Route>
                <Route path="/repurpose"><ProtectedRoute><Repurpose /></ProtectedRoute></Route>
                <Route component={NotFound} />
              </Switch>
            </AuthedLayout>
          </Route>
        </Switch>
        </RouteErrorBoundary>
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
