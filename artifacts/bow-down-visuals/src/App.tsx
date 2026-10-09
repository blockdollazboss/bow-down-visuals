import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { CreateRedirect } from "@/components/create-redirect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useRef, Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/contexts/AuthContext";
import { HubProjectProvider } from "@/lib/hub-project";
import { ActiveArtistProvider } from "@/contexts/ActiveArtistContext";
import { CharacterThemeApplier } from "@/components/CharacterThemeApplier";
import { ThemePlayerProvider } from "@/contexts/ThemePlayerContext";
import { UserModeProvider } from "@/contexts/UserModeContext";
import { CreditConfirmProvider } from "@/contexts/CreditConfirmContext";
import { StreamingPlayerProvider } from "@/contexts/StreamingPlayerContext";
import { StreamingPlayerBar } from "@/components/player/StreamingPlayerBar";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { BowDownAIGuide } from "@/components/BowDownAIGuide";
import { ThyCheatCodeChat } from "@/components/ThyCheatCodeChat";
import { ThyCheatCodeHost } from "@/components/ThyCheatCodeHost";
import { GuideMe } from "@/components/GuideMe";
import { HelpPanel } from "@/components/HelpPanel";
import { CheatCodeEasterEgg } from "@/components/cheat-code-easter-egg";
import { CheatCodeJackpot } from "@/components/cheat-code-jackpot";
import { DailyBonusModal } from "@/components/DailyBonusModal";
import ExtensionPromoModal from "@/components/ExtensionPromoModal";
import { MysteryCrate } from "@/components/MysteryCrate";
import { CustomCursor } from "@/components/CustomCursor";
import { OnboardingTour } from "@/components/OnboardingTour";
import { SiteFooter } from "@/components/layout/footer";
import { VideoBanner } from "@/components/layout/video-banner";
import { MobileSidebarTrigger } from "@/components/layout/mobile-sidebar-trigger";
import { FloatingStarLevel } from "@/components/layout/floating-star-level";
import { FloatingAdminPanel } from "@/components/layout/floating-admin-panel";
import { FloatingLanguageSwitcher } from "@/components/layout/floating-language-switcher";
import { LiveBadge } from "@/components/LiveBadge";
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
import CreatorPricing from "@/pages/creator-pricing";
import Waitlist from "@/pages/waitlist";
import Extension from "@/pages/extension";
import Download from "@/pages/download";
import TemplatesHub from "@/pages/templates/index";
import VideoTemplates from "@/pages/templates/videos";
import ThumbnailTemplates from "@/pages/templates/thumbnails";
import HookTemplates from "@/pages/templates/hooks";
import CaptionPacks from "@/pages/templates/captions";
/* SEO programmatic pages (Worker 9, virality wave): tool pages, vertical
   hubs, genre hubs — static imports so they render without lazy flash. */
import ToolsIndex from "@/pages/seo/tools-index";
import ForIndex from "@/pages/seo/for-index";
import { ToolPageBySlug } from "@/pages/seo/tool-page";
import { VerticalHubBySlug } from "@/pages/seo/vertical-hub";
import { GenreHubBySlug } from "@/pages/seo/genre-hub";
import Showcase from "@/pages/showcase/index";
import ShowcaseItemPage from "@/pages/showcase/item";
import PublicAlbumPage from "@/pages/albums/public";
import PlanPublic from "@/pages/plan-public";

/* Discovery (Worker 6): charts, search, browse, verticals, genres, feed. */
const Charts = lazyWithRetry(() => import("@/pages/discovery/charts"));
const DiscoverySearch = lazyWithRetry(() => import("@/pages/discovery/search"));
const Browse = lazyWithRetry(() => import("@/pages/discovery/browse"));
const VerticalPage = lazyWithRetry(() => import("@/pages/discovery/vertical"));
const Genres = lazyWithRetry(() => import("@/pages/discovery/genres"));
const GenrePage = lazyWithRetry(() => import("@/pages/discovery/genre"));
const Feed = lazyWithRetry(() => import("@/pages/discovery/feed"));

/* Social (Worker 8): home timeline, trending, saved. */
const SocialHome = lazyWithRetry(() => import("@/pages/feed"));
const Trending = lazyWithRetry(() => import("@/pages/trending"));
const Saved = lazyWithRetry(() => import("@/pages/saved"));

const Dashboard     = lazyWithRetry(() => import("@/pages/dashboard"));
const ChooseArtist  = lazyWithRetry(() => import("@/pages/choose-artist"));
const Create        = lazyWithRetry(() => import("@/pages/create"));
const VideoStudio   = lazyWithRetry(() => import("@/pages/video-studio"));
const PromoClip     = lazyWithRetry(() => import("@/pages/promo-clip"));
const ArtistVault   = lazyWithRetry(() => import("@/pages/artist-vault"));
const MyProjects    = lazyWithRetry(() => import("@/pages/my-projects"));
const Generations   = lazyWithRetry(() => import("@/pages/generations"));
const VideoEditor   = lazyWithRetry(() => import("@/pages/video-editor"));
const BetaAccess    = lazyWithRetry(() => import("@/pages/beta-access"));
const InvitePage    = lazyWithRetry(() => import("@/pages/invite"));
const Contact       = lazyWithRetry(() => import("@/pages/contact"));
const Login         = lazyWithRetry(() => import("@/pages/login"));
const Signup        = lazyWithRetry(() => import("@/pages/signup"));
const NotFound      = lazyWithRetry(() => import("@/pages/not-found"));
const CreditHistory = lazyWithRetry(() => import("@/pages/credit-history"));
const Admin         = lazyWithRetry(() => import("@/pages/admin"));
const Locations     = lazyWithRetry(() => import("@/pages/locations"));
const Terms         = lazyWithRetry(() => import("@/pages/terms"));
const Privacy       = lazyWithRetry(() => import("@/pages/privacy"));
const RefundPolicy  = lazyWithRetry(() => import("@/pages/refund-policy"));
const HookStudio    = lazyWithRetry(() => import("@/pages/hooks"));
const ShortsFeed      = lazyWithRetry(() => import("@/pages/shorts"));
const SoundDetailPage = lazyWithRetry(() => import("@/pages/sound"));
const ChallengePage   = lazyWithRetry(() => import("@/pages/challenge"));
const WinnersPage     = lazyWithRetry(() => import("@/pages/winners"));
const HashtagPage     = lazyWithRetry(() => import("@/pages/hashtag"));
// ── Creator Streaming Platform pages ──
const ArtistPublic = lazyWithRetry(() => import("@/pages/artist-public"));
const ArtistSetup = lazyWithRetry(() => import("@/pages/artist-setup"));
const Publish = lazyWithRetry(() => import("@/pages/publish"));
const StreamTrackPage = lazyWithRetry(() => import("@/pages/stream/track"));
const StreamWatchPage = lazyWithRetry(() => import("@/pages/stream/watch"));
const StreamPlaylistPage = lazyWithRetry(() => import("@/pages/stream/playlist"));
const CreatorDomainsPage = lazyWithRetry(() => import("@/pages/creator-domains"));
const StoreDashboard = lazyWithRetry(() => import("@/pages/store-dashboard"));
import { SiteModeGate } from "@/components/site-mode/SiteMode";
import { NotificationsBell } from "@/components/discovery/NotificationsBell";
const FogLab        = lazyWithRetry(() => import("@/pages/fog-lab"));
const CursorLab     = lazyWithRetry(() => import("@/pages/cursor-lab"));
const TourPlanner = lazyWithRetry(() => import("@/pages/tour"));
const MonetizationCoach = lazyWithRetry(() => import("@/pages/coach"));
const BrandDealCalculator = lazyWithRetry(() => import("@/pages/brand-calculator"));
const CreatorAcademy = lazyWithRetry(() => import("@/pages/academy"));
const BrandDealFinder = lazyWithRetry(() => import("@/pages/brand-deals"));
const Distribute = lazyWithRetry(() => import("@/pages/distribute"));
const Presave = lazyWithRetry(() => import("@/pages/presave"));
const SplitsAgreement = lazyWithRetry(() => import("@/pages/splits-agreement"));
const Scheduler = lazyWithRetry(() => import("@/pages/scheduler"));
const Tips = lazyWithRetry(() => import("@/pages/tips"));
const Referrals = lazyWithRetry(() => import("@/pages/referrals"));
const TeamPage = lazyWithRetry(() => import("@/pages/team"));
const TipPage = lazyWithRetry(() => import("@/pages/tip-page"));
const InterviewPrep = lazyWithRetry(() => import("@/pages/interview-prep"));
const Upscale = lazyWithRetry(() => import("@/pages/upscale"));
const AudioStudio = lazyWithRetry(() => import("@/pages/audio-studio"));
const MediaImport = lazyWithRetry(() => import("@/pages/import"));
const BrandingKit = lazyWithRetry(() => import("@/pages/branding-kit"));
const AnalyticsHub = lazyWithRetry(() => import("@/pages/analytics-hub"));
const SetlistBuilder = lazyWithRetry(() => import("@/pages/setlist"));
const CopyrightAssistant = lazyWithRetry(() => import("@/pages/copyright"));
const LlcGuide = lazyWithRetry(() => import("@/pages/llc-guide"));
const Features = lazyWithRetry(() => import("@/pages/features"));
const Promote = lazyWithRetry(() => import("@/pages/promote"));
const GoLive = lazyWithRetry(() => import("@/pages/go-live"));
const Guides = lazyWithRetry(() => import("@/pages/guides"));
const NfcCards = lazyWithRetry(() => import("@/pages/nfc-cards"));
const JewelryShop = lazyWithRetry(() => import("@/pages/jewelry-shop"));
const NfcCardProfile = lazyWithRetry(() => import("@/pages/nfc-card-profile"));
const BioPublic = lazyWithRetry(() => import("@/pages/bio-public"));
const ReviewPage = lazyWithRetry(() => import("@/pages/review"));
const SyncOneSheetPublic = lazyWithRetry(() => import("@/pages/sync-one-sheet-public"));
const Settings = lazyWithRetry(() => import("@/pages/settings"));
const ThumbnailStudio = lazyWithRetry(() => import("@/pages/thumbnail-studio"));
const CartoonStudio = lazyWithRetry(() => import("@/pages/cartoon-studio"));
const LabelPitch = lazyWithRetry(() => import("@/pages/label-pitch"));
const Contracts = lazyWithRetry(() => import("@/pages/contracts"));
const Movies = lazyWithRetry(() => import("@/pages/movies"));
const WebsiteBuilder = lazyWithRetry(() => import("@/pages/website-builder"));
const MediaDetector = lazyWithRetry(() => import("@/pages/media-detector"));
const Shoutouts = lazyWithRetry(() => import("@/pages/shoutouts"));
/* ── Worker 9: community — groups / events / DMs / explore ── */
const Groups = lazyWithRetry(() => import("@/pages/groups"));
const GroupDetail = lazyWithRetry(() => import("@/pages/group-detail"));
const Events = lazyWithRetry(() => import("@/pages/events"));
const EventDetailPage = lazyWithRetry(() => import("@/pages/event-detail"));
const Messages = lazyWithRetry(() => import("@/pages/messages"));
const Explore = lazyWithRetry(() => import("@/pages/explore"));
/* ── Orphaned feature pages wired up (site organization) ── */
const CoverArt = lazyWithRetry(() => import("@/pages/cover-art"));
const LyricVideo = lazyWithRetry(() => import("@/pages/lyric-video"));
const Translate = lazyWithRetry(() => import("@/pages/translate"));
const Repurpose = lazyWithRetry(() => import("@/pages/repurpose"));
const PressKit = lazyWithRetry(() => import("@/pages/press-kit"));
const PressPublic = lazyWithRetry(() => import("@/pages/press-public"));
const EmailList = lazyWithRetry(() => import("@/pages/email-list"));
const Collabs = lazyWithRetry(() => import("@/pages/collabs"));
const SponsorPost = lazyWithRetry(() => import("@/pages/sponsors-post"));
const SponsorDealDetail = lazyWithRetry(() => import("@/pages/sponsor-deal-detail"));
const SponsorDashboard = lazyWithRetry(() => import("@/pages/sponsor-dashboard"));
const Contests = lazyWithRetry(() => import("@/pages/contests"));
const Community = lazyWithRetry(() => import("@/pages/community"));
const MyShop = lazyWithRetry(() => import("@/pages/my-shop"));
const StoreBuy = lazyWithRetry(() => import("@/pages/store-buy"));
const StoreSuccess = lazyWithRetry(() => import("@/pages/store-success"));
const MyMusic = lazyWithRetry(() => import("@/pages/my-music"));
const Storefronts = lazyWithRetry(() => import("@/pages/storefronts"));
const StorefrontBuilder = lazyWithRetry(() => import("@/pages/storefront-builder"));
const ShopStorefront = lazyWithRetry(() => import("@/pages/shop"));
const Beats = lazyWithRetry(() => import("@/pages/beats"));
const Memberships = lazyWithRetry(() => import("@/pages/memberships"));
const Join = lazyWithRetry(() => import("@/pages/join"));/**
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
    <div className="min-h-screen flex items-center justify-center bg-black no-throne-bg">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

/**
 * Authenticated app layout: the interactive video banner strip sits on top
 * (exactly where the old toolbar lived), with persistent sidebar navigation
 * (plus the admin-only Admin link) beside the page content. The sidebar is
 * collapsible on desktop — the collapsed choice persists in localStorage —
 * and a floating expand button guarantees the user can always bring it
 * back. On mobile the sidebar renders as a drawer opened by the floating
 * MobileSidebarTrigger (the old desktop-only expand button had no mobile
 * equivalent). The video editor keeps its full-viewport studio surface and
 * stays outside this layout.
 */
function AuthedLayout({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapsed();
  const userTouchedSidebar = useRef(false);
  const [location] = useLocation();
  /* Homepage keeps its full-bleed stage design — no content panel. */
  const isHome = location === "/";

  // Sidebar preview: start open so the user sees where everything is,
  // then auto-close after a moment. Manual toggle cancels the auto-close.
  useEffect(() => {
    setSidebarCollapsed(false);
    const t = setTimeout(() => {
      if (!userTouchedSidebar.current) setSidebarCollapsed(true);
    }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenChange = (open: boolean) => {
    userTouchedSidebar.current = true;
    setSidebarCollapsed(!open);
  };

  return (
    <SidebarProvider
      open={!sidebarCollapsed}
      onOpenChange={handleOpenChange}
    >
      <div className="flex min-h-svh w-full">
        {!isHome && <AppSidebar />}
        <div className="min-w-0 flex-1 flex flex-col">
          <div className="sticky top-0 z-40 relative">
            <VideoBanner />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <NotificationsBell />
            </div>
          </div>
          <main className="min-w-0 flex-1 relative">
            <ThyCheatCodeHost />
            {isHome ? (
              children
            ) : (
              <div className="content-panel mx-4 my-4 md:mx-6 md:my-6 p-4 md:p-6 min-h-[calc(100%-2rem)]">
                {children}
              </div>
            )}
          </main>
        </div>
        <ExpandSidebarButton
          collapsed={sidebarCollapsed}
          onExpand={() => setSidebarCollapsed(false)}
        />
        <LiveBadge />
        {!isHome && <MobileSidebarTrigger />}
        <FloatingStarLevel />
        <FloatingAdminPanel />
        <FloatingLanguageSwitcher />
        {typeof window !== "undefined" && <OnboardingTour />}
        {typeof window !== "undefined" && <StreamingPlayerBar />}
      </div>
    </SidebarProvider>
  );
}

function AppShell() {
  const [location] = useLocation();
  /* Capture referral code from ?ref= (e.g. /?ref=ABC123) — persisted for
   * post-signup credit award. */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (ref && /^[A-Za-z0-9]{4,16}$/.test(ref)) {
        localStorage.setItem("bdv_referral_code", ref.toUpperCase());
      }
      /* Capture waitlist invite code from ?invite= (e.g. /invite/ABC123 deep
       * links) — persisted so signup can auto-apply it to the inviter. */
      const invite = params.get("invite");
      if (invite && /^[A-Za-z0-9]{4,16}$/.test(invite)) {
        localStorage.setItem("bdv_waitlist_invite", invite.toUpperCase());
      }
    } catch { /* noop */ }
  }, []);
  /* The video editor is a full-viewport studio surface — the marketing site
   * footer doesn't belong under it. Same for the client review page: it's a
   * focused, premium client surface, not a marketing page. */
  const hideFooter = location.startsWith("/video-editor") || location.startsWith("/review");
  /* Marketing pages (outside the sidebar layout) where Thy Cheat Code coaches
   * in-flow. Auth/legal/fan pages are excluded by the host itself. */
  const marketingCoachRoute = ["/pricing", "/shows", "/brand-deals", "/coach", "/academy"]
    .includes(location.split("?")[0].split("#")[0]);
  return (
    <>
      <ScrollToTop />
      {typeof window !== "undefined" && <BowDownAIGuide />}
      {typeof window !== "undefined" && <ThyCheatCodeChat />}
      {typeof window !== "undefined" && <GuideMe />}
      {typeof window !== "undefined" && <HelpPanel />}
      {typeof window !== "undefined" && <CheatCodeEasterEgg />}
      {typeof window !== "undefined" && <CheatCodeJackpot />}
      {typeof window !== "undefined" && <DailyBonusModal />}
      {typeof window !== "undefined" && <ExtensionPromoModal />}
      {typeof window !== "undefined" && <MysteryCrate />}
      {typeof window !== "undefined" && <CustomCursor />}
      {marketingCoachRoute && <ThyCheatCodeHost />}
      <Suspense fallback={<RouteFallback />}>
        <RouteErrorBoundary key={location}>
        <Switch>
          {/* Auth routes */}
          <Route path="/login"><Login /></Route>
          <Route path="/signup"><Signup /></Route>

          {/* Marketing (home lives inside the sidebar layout below) */}
          <Route path="/pricing"><Pricing /></Route>
          <Route path="/creator-pricing"><CreatorPricing /></Route>
          <Route path="/waitlist"><Waitlist /></Route>
          <Route path="/extension"><Extension /></Route>
          <Route path="/download"><Download /></Route>
          <Route path="/templates"><TemplatesHub /></Route>
          <Route path="/templates/videos"><VideoTemplates /></Route>
          <Route path="/templates/thumbnails"><ThumbnailTemplates /></Route>
          <Route path="/templates/hooks"><HookTemplates /></Route>
          <Route path="/templates/captions"><CaptionPacks /></Route>
          {/* SEO programmatic pages — public, no login, prerendered at build */}
          <Route path="/tools"><ToolsIndex /></Route>
          <Route path="/tools/ai-thumbnail-maker"><ToolPageBySlug slug="ai-thumbnail-maker" /></Route>
          <Route path="/tools/ai-hook-generator"><ToolPageBySlug slug="ai-hook-generator" /></Route>
          <Route path="/tools/ai-music-video-maker"><ToolPageBySlug slug="ai-music-video-maker" /></Route>
          <Route path="/tools/ai-caption-generator"><ToolPageBySlug slug="ai-caption-generator" /></Route>
          <Route path="/tools/ai-clip-maker"><ToolPageBySlug slug="ai-clip-maker" /></Route>
          <Route path="/tools/ai-song-maker"><ToolPageBySlug slug="ai-song-maker" /></Route>
          <Route path="/for"><ForIndex /></Route>
          <Route path="/for/youtubers"><VerticalHubBySlug slug="youtubers" /></Route>
          <Route path="/for/podcasters"><VerticalHubBySlug slug="podcasters" /></Route>
          <Route path="/for/streamers"><VerticalHubBySlug slug="streamers" /></Route>
          <Route path="/for/musicians"><VerticalHubBySlug slug="musicians" /></Route>
          <Route path="/for/tiktokers"><VerticalHubBySlug slug="tiktokers" /></Route>
          <Route path="/for/educators"><VerticalHubBySlug slug="educators" /></Route>
          <Route path="/genres/hip-hop"><GenreHubBySlug slug="hip-hop" /></Route>
          <Route path="/genres/pop"><GenreHubBySlug slug="pop" /></Route>
          <Route path="/genres/edm"><GenreHubBySlug slug="edm" /></Route>
          <Route path="/genres/rock"><GenreHubBySlug slug="rock" /></Route>
          <Route path="/genres/rnb"><GenreHubBySlug slug="rnb" /></Route>
          <Route path="/genres/lofi"><GenreHubBySlug slug="lofi" /></Route>
          <Route path="/genres/country"><GenreHubBySlug slug="country" /></Route>
          <Route path="/genres/trap"><GenreHubBySlug slug="trap" /></Route>
          {/* Discovery — public, no login: charts, search, browse, vertical + genre hubs */}
          <Route path="/charts"><Charts /></Route>
          <Route path="/search"><DiscoverySearch /></Route>
          <Route path="/browse"><Browse /></Route>
          <Route path="/vertical/:vertical"><VerticalPage /></Route>
          <Route path="/genres"><Genres /></Route>
          <Route path="/genre/:genre"><GenrePage /></Route>
          <Route path="/showcase"><Showcase /></Route>
          <Route path="/showcase/:slug"><ShowcaseItemPage /></Route>
          <Route path="/albums/:slug"><PublicAlbumPage /></Route>
          <Route path="/plan/:slug"><PlanPublic /></Route>
          <Route path="/beta-access"><BetaAccess /></Route>
          <Route path="/invite/:code"><InvitePage /></Route>
          <Route path="/contact"><Contact /></Route>
          <Route path="/terms"><Terms /></Route>
          <Route path="/privacy"><Privacy /></Route>
          <Route path="/refund-policy"><RefundPolicy /></Route>
          <Route path="/randomizer"><Redirect to="/hooks?tab=dice" /></Route>
          <Route path="/hooks"><HookStudio /></Route>
          <Route path="/sounds"><Redirect to="/audio-studio?tab=sounds" /></Route>
          {/* Shorts — vertical feed, sound pages, challenge pages, hashtag hub (public) */}
          <Route path="/shorts"><ShortsFeed /></Route>
          <Route path="/sound/:id"><SoundDetailPage /></Route>
          {/* Winners' circle — before /challenge/:slug so the Switch matches the longer path first */}
          <Route path="/challenge/:slug/winners"><WinnersPage /></Route>
          <Route path="/winners"><WinnersPage /></Route>
          <Route path="/challenge/:slug"><ChallengePage /></Route>
          <Route path="/hashtag/:tag"><HashtagPage /></Route>
          {/* Creator Streaming Platform — public surfaces */}
          <Route path="/artist/:slug"><ArtistPublic /></Route>
          <Route path="/track/:id"><StreamTrackPage /></Route>
          <Route path="/watch/:id"><StreamWatchPage /></Route>
          <Route path="/playlist/:id"><StreamPlaylistPage /></Route>
          <Route path="/comment-replies"><Redirect to="/community?tab=replies" /></Route>
          {/* Staging-only fog comparison lab (hidden route, no nav link) */}
          <Route path="/fog-lab"><FogLab /></Route>
          <Route path="/cursor-lab"><CursorLab /></Route>
          <Route path="/tour"><TourPlanner /></Route>
          <Route path="/coach"><MonetizationCoach /></Route>
          <Route path="/brand-calculator"><BrandDealCalculator /></Route>
          <Route path="/academy"><CreatorAcademy /></Route>
          <Route path="/content-calendar"><Redirect to="/scheduler?tab=calendar" /></Route>
          <Route path="/sponsors"><Redirect to="/brand-deals?tab=marketplace" /></Route>
          <Route path="/shows"><Redirect to="/go-live?tab=shows" /></Route>
          <Route path="/brand-deals"><BrandDealFinder /></Route>
          <Route path="/distribute"><Distribute /></Route>
          <Route path="/presave/:slug"><Presave /></Route>
          <Route path="/splits/:slug"><SplitsAgreement /></Route>
          <Route path="/upscale"><Upscale /></Route>
          <Route path="/scheduler"><Scheduler /></Route>
          <Route path="/tips"><Tips /></Route>
          <Route path="/home"><ProtectedRoute><SocialHome /></ProtectedRoute></Route>
          <Route path="/trending"><Trending /></Route>
          <Route path="/saved"><ProtectedRoute><Saved /></ProtectedRoute></Route>
          <Route path="/tips/:handle"><TipPage /></Route>
          <Route path="/referrals"><Referrals /></Route>
          <Route path="/team"><TeamPage /></Route>
          <Route path="/storefronts"><Storefronts /></Route>
          <Route path="/shop/:slug"><ShopStorefront /></Route>          <Route path="/interview-prep"><InterviewPrep /></Route>          <Route path="/upscale"><Upscale /></Route>
          <Route path="/watermark-removal"><Redirect to="/upscale?tab=enhance" /></Route>
          <Route path="/audio-cleanup"><Redirect to="/audio-studio?tab=cleanup" /></Route>
          <Route path="/setlist"><SetlistBuilder /></Route>
          <Route path="/analytics"><Redirect to="/analytics-hub?tab=connected" /></Route>
          <Route path="/import"><MediaImport /></Route>
          <Route path="/logo-maker"><Redirect to="/branding-kit?tab=logo" /></Route>
          <Route path="/branding-kit"><BrandingKit /></Route>
          <Route path="/virality-check"><Redirect to="/analytics-hub?tab=virality" /></Route>
          <Route path="/analytics-hub"><AnalyticsHub /></Route>
          <Route path="/intros-outros"><Redirect to="/branding-kit?tab=intros" /></Route>
          <Route path="/stream-pack"><Redirect to="/branding-kit?tab=stream" /></Route>
          <Route path="/copyright"><CopyrightAssistant /></Route>
          <Route path="/llc-guide"><LlcGuide /></Route>
          {/* Public press kit view + email-list join landing (fan-facing) */}
          <Route path="/press/:id"><PressPublic /></Route>
          <Route path="/join/:handle"><Join /></Route>
          <Route path="/features"><Features /></Route>
          <Route path="/promote"><Promote /></Route>
          <Route path="/guides"><Guides /></Route>
          <Route path="/clip-maker"><Redirect to="/repurpose?mode=stream" /></Route>
          <Route path="/branding-shop"><Redirect to="/branding-kit?tab=shop" /></Route>
          <Route path="/nfc-cards"><NfcCards /></Route>
          <Route path="/jewelry-shop"><JewelryShop /></Route>
          {/* Public NFC smart-card profile (tap/QR destination) */}
          <Route path="/c/:slug"><NfcCardProfile /></Route>
          {/* Public link-in-bio page (no login) — viral fan surface */}
          <Route path="/bio/:slug"><BioPublic /></Route>
          {/* Public client review page (tokenized, no login) — the client's handshake with the product */}
          <Route path="/review/:token"><ReviewPage /></Route>
          {/* Public sync one-sheet (tokenized, no login) — shareable supervisor link with ?ref=CODE */}
          <Route path="/sync-one-sheet/:token"><SyncOneSheetPublic /></Route>
          {/* Worker 9: community — groups / events / explore are public (viral surfaces); DMs need auth */}
          <Route path="/groups"><Groups /></Route>
          <Route path="/groups/:slug"><GroupDetail /></Route>
          <Route path="/events"><Events /></Route>
          <Route path="/events/:id"><EventDetailPage /></Route>
          <Route path="/explore"><Explore /></Route>

          {/* Protected app pages — inside the sidebar layout */}
          {/* The video editor keeps its full-viewport studio surface. */}
          <Route path="/video-editor"><ProtectedRoute><VideoEditor /></ProtectedRoute></Route>
          <Route>
            <AuthedLayout>
              <Switch>
                {/* Home is public: signed-in visitors are redirected to
                    /choose-artist by the page itself; everyone gets the
                    sidebar + banner shell. */}
                <Route path="/"><Home /></Route>
                <Route path="/dashboard"><ProtectedRoute><Dashboard /></ProtectedRoute></Route>
                <Route path="/choose-artist"><ProtectedRoute><ChooseArtist /></ProtectedRoute></Route>
                <Route path="/my-projects"><ProtectedRoute><MyProjects /></ProtectedRoute></Route>
                <Route path="/generations"><ProtectedRoute><Generations /></ProtectedRoute></Route>
                <Route path="/artist-vault"><ProtectedRoute><ArtistVault /></ProtectedRoute></Route>
                <Route path="/make-song"><CreateRedirect to="/create?panel=song" /></Route>
                <Route path="/make-video"><CreateRedirect to="/create?panel=video" /></Route>
                <Route path="/video-studio"><ProtectedRoute><VideoStudio /></ProtectedRoute></Route>
                <Route path="/song-and-video"><CreateRedirect to="/create?panel=song-video" /></Route>
                <Route path="/create"><ProtectedRoute><Create /></ProtectedRoute></Route>
                <Route path="/promo-clip"><ProtectedRoute><PromoClip /></ProtectedRoute></Route>
                <Route path="/thumbnail"><Redirect to="/thumbnail-studio?tab=generate" /></Route>
                <Route path="/thumbnails"><Redirect to="/thumbnail-studio?tab=library" /></Route>
                <Route path="/credit-history"><ProtectedRoute><CreditHistory /></ProtectedRoute></Route>
                <Route path="/settings"><ProtectedRoute><Settings /></ProtectedRoute></Route>
                <Route path="/my-clips"><Redirect to="/my-projects?tab=myclips" /></Route>
                <Route path="/admin"><ProtectedRoute><Admin /></ProtectedRoute></Route>
                <Route path="/songs"><Redirect to="/my-projects?tab=songs" /></Route>
                <Route path="/locations"><ProtectedRoute><Locations /></ProtectedRoute></Route>
                <Route path="/thumbnail-maker"><Redirect to="/thumbnail-studio?tab=generate" /></Route>
                <Route path="/thumbnail-studio"><ProtectedRoute><ThumbnailStudio /></ProtectedRoute></Route>
                <Route path="/cartoon-studio"><ProtectedRoute><CartoonStudio /></ProtectedRoute></Route>
                <Route path="/merch"><Redirect to="/branding-shop?tab=merch" /></Route>
                <Route path="/playlist-pitch"><Redirect to="/label-pitch?mode=playlists" /></Route>
                <Route path="/label-pitch"><ProtectedRoute><LabelPitch /></ProtectedRoute></Route>
                <Route path="/channel-audit"><Redirect to="/analytics-hub?tab=channel-audit" /></Route>
                <Route path="/contracts"><ProtectedRoute><Contracts /></ProtectedRoute></Route>
                <Route path="/movies"><ProtectedRoute><Movies /></ProtectedRoute></Route>
                <Route path="/website-builder"><ProtectedRoute><WebsiteBuilder /></ProtectedRoute></Route>
                <Route path="/detector"><ProtectedRoute><MediaDetector /></ProtectedRoute></Route>
                <Route path="/sponsorship-outreach"><Redirect to="/brand-deals?tab=pitch" /></Route>
                <Route path="/shoutouts"><ProtectedRoute><Shoutouts /></ProtectedRoute></Route>
                <Route path="/release-checklist"><Redirect to="/distribute?tab=plan" /></Route>
                <Route path="/go-live"><ProtectedRoute><GoLive /></ProtectedRoute></Route>
                <Route path="/discord-bot"><Redirect to="/go-live?tab=discord" /></Route>
                <Route path="/jewelry"><Redirect to="/branding-kit?tab=jewelry" /></Route>
                <Route path="/gamers"><Redirect to="/go-live?tab=gamers" /></Route>
                {/* ── Wired-up orphaned pages (site organization) ── */}
                <Route path="/caption-styler"><Redirect to="/hooks?tab=styler" /></Route>
                <Route path="/cover-art"><ProtectedRoute><CoverArt /></ProtectedRoute></Route>
                <Route path="/lyric-video"><ProtectedRoute><LyricVideo /></ProtectedRoute></Route>
                <Route path="/translate"><ProtectedRoute><Translate /></ProtectedRoute></Route>
                <Route path="/script-writer"><Redirect to="/hooks?tab=scripts" /></Route>
                <Route path="/repurpose"><ProtectedRoute><Repurpose /></ProtectedRoute></Route>
                <Route path="/trends"><Redirect to="/scheduler?tab=trends" /></Route>
                {/* Discovery feed — new drops from followed creators (auth) */}
                <Route path="/feed"><ProtectedRoute><Feed /></ProtectedRoute></Route>
                <Route path="/thumbnail-test"><Redirect to="/thumbnail-studio?tab=abtest" /></Route>
                <Route path="/audio-studio"><ProtectedRoute><AudioStudio /></ProtectedRoute></Route>
                <Route path="/ai-audio"><Redirect to="/audio-studio?tab=aiaudio" /></Route>
                <Route path="/vocal-removal"><Redirect to="/audio-studio?tab=stems&mode=vocals" /></Route>
                <Route path="/voiceover"><Redirect to="/audio-studio?tab=voiceover" /></Route>
                <Route path="/press-kit"><ProtectedRoute><PressKit /></ProtectedRoute></Route>
                <Route path="/email-list"><ProtectedRoute><EmailList /></ProtectedRoute></Route>
                <Route path="/collabs"><ProtectedRoute><Collabs /></ProtectedRoute></Route>
                <Route path="/sponsors/post"><ProtectedRoute><SponsorPost /></ProtectedRoute></Route>
                <Route path="/sponsors/dashboard"><ProtectedRoute><SponsorDashboard /></ProtectedRoute></Route>
                <Route path="/sponsors/:id"><ProtectedRoute><SponsorDealDetail /></ProtectedRoute></Route>
                <Route path="/contests"><ProtectedRoute><Contests /></ProtectedRoute></Route>
                <Route path="/titles"><Redirect to="/hooks?tab=titles" /></Route>
                <Route path="/community"><ProtectedRoute><Community /></ProtectedRoute></Route>
                <Route path="/mastering"><Redirect to="/audio-studio?tab=master&mode=quick" /></Route>
                <Route path="/mix-master"><Redirect to="/audio-studio?tab=master" /></Route>
                <Route path="/stems"><Redirect to="/audio-studio?tab=stems" /></Route>
                <Route path="/sfx"><Redirect to="/ai-audio?tab=sfx" /></Route>
                <Route path="/samples"><Redirect to="/ai-audio?tab=samples" /></Route>
                <Route path="/podcast"><Redirect to="/audio-studio?tab=podcast" /></Route>
                <Route path="/beats"><ProtectedRoute><Beats /></ProtectedRoute></Route>
                <Route path="/beat-maker"><Redirect to="/ai-audio?tab=beats" /></Route>
                <Route path="/hub"><CreateRedirect to="/create?panel=hub" /></Route>
                <Route path="/messages"><ProtectedRoute><Messages /></ProtectedRoute></Route>
                <Route path="/live-shopping"><Redirect to="/go-live?tab=shopping" /></Route>
                <Route path="/memberships"><ProtectedRoute><Memberships /></ProtectedRoute></Route>
                <Route path="/royalties"><Redirect to="/coach?tab=money&view=royalties" /></Route>
                <Route path="/my-shop"><ProtectedRoute><MyShop /></ProtectedRoute></Route>
                <Route path="/store/buy/:kind/:id"><StoreBuy /></Route>
                <Route path="/store/success"><StoreSuccess /></Route>
                <Route path="/my-music"><ProtectedRoute><MyMusic /></ProtectedRoute></Route>
                {/* Creator Streaming Platform — creator tools */}
                <Route path="/artist-setup"><ProtectedRoute><ArtistSetup /></ProtectedRoute></Route>
                <Route path="/publish"><ProtectedRoute><Publish /></ProtectedRoute></Route>
                <Route path="/creator/domains"><ProtectedRoute><CreatorDomainsPage /></ProtectedRoute></Route>
                <Route path="/store/dashboard"><ProtectedRoute><StoreDashboard /></ProtectedRoute></Route>
                <Route path="/music-sales"><Redirect to="/store/dashboard?view=digital" /></Route>
                <Route path="/storefronts/builder"><ProtectedRoute><StorefrontBuilder /></ProtectedRoute></Route>

                <Route path="/discord-bot"><Redirect to="/go-live?tab=discord" /></Route>
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
              <HubProjectProvider>
              <UserModeProvider>
                <CreditConfirmProvider>
                  <ActiveArtistProvider>
                    <StreamingPlayerProvider>
                      <CharacterThemeApplier />
                      <SiteModeGate>
                        <AppShell />
                      </SiteModeGate>
                    </StreamingPlayerProvider>
                  </ActiveArtistProvider>
                </CreditConfirmProvider>
              </UserModeProvider>
              </HubProjectProvider>
            </AuthProvider>
          </ThemePlayerProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
