import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
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
import Waitlist from "@/pages/waitlist";
import Extension from "@/pages/extension";
import Download from "@/pages/download";
import TemplatesHub from "@/pages/templates/index";
import ThumbnailTemplates from "@/pages/templates/thumbnails";
import HookTemplates from "@/pages/templates/hooks";
import CaptionPacks from "@/pages/templates/captions";
import Showcase from "@/pages/showcase/index";
import ShowcaseItemPage from "@/pages/showcase/item";
import PlanPublic from "@/pages/plan-public";

const Dashboard     = lazyWithRetry(() => import("@/pages/dashboard"));
const ChooseArtist  = lazyWithRetry(() => import("@/pages/choose-artist"));
const MakeSong      = lazyWithRetry(() => import("@/pages/make-song"));
const MakeVideo     = lazyWithRetry(() => import("@/pages/make-video"));
const SongAndVideo  = lazyWithRetry(() => import("@/pages/song-and-video"));
const VideoStudio   = lazyWithRetry(() => import("@/pages/video-studio"));
const CreateSimple  = lazyWithRetry(() => import("@/pages/create-simple"));
const PromoClip     = lazyWithRetry(() => import("@/pages/promo-clip"));
const Thumbnail     = lazyWithRetry(() => import("@/pages/thumbnail"));
const Thumbnails    = lazyWithRetry(() => import("@/pages/thumbnails"));
const ArtistVault   = lazyWithRetry(() => import("@/pages/artist-vault"));
const MyProjects    = lazyWithRetry(() => import("@/pages/my-projects"));
const Generations   = lazyWithRetry(() => import("@/pages/generations"));
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
const SoundFinder     = lazyWithRetry(() => import("@/pages/sounds"));
const CommentReplies = lazyWithRetry(() => import("@/pages/comment-replies"));
const FogLab        = lazyWithRetry(() => import("@/pages/fog-lab"));
const CursorLab     = lazyWithRetry(() => import("@/pages/cursor-lab"));
const TourPlanner = lazyWithRetry(() => import("@/pages/tour"));
const MonetizationCoach = lazyWithRetry(() => import("@/pages/coach"));
const BrandDealCalculator = lazyWithRetry(() => import("@/pages/brand-calculator"));
const CreatorAcademy = lazyWithRetry(() => import("@/pages/academy"));
const ContentCalendar = lazyWithRetry(() => import("@/pages/content-calendar"));
const SponsorMarketplace = lazyWithRetry(() => import("@/pages/sponsors"));
const ShowFinder = lazyWithRetry(() => import("@/pages/shows"));
const BrandDealFinder = lazyWithRetry(() => import("@/pages/brand-deals"));
const Distribute = lazyWithRetry(() => import("@/pages/distribute"));
const Presave = lazyWithRetry(() => import("@/pages/presave"));
const Scheduler = lazyWithRetry(() => import("@/pages/scheduler"));
const Tips = lazyWithRetry(() => import("@/pages/tips"));
const Referrals = lazyWithRetry(() => import("@/pages/referrals"));
const TeamPage = lazyWithRetry(() => import("@/pages/team"));
const TipPage = lazyWithRetry(() => import("@/pages/tip-page"));
const InterviewPrep = lazyWithRetry(() => import("@/pages/interview-prep"));
const Upscale = lazyWithRetry(() => import("@/pages/upscale"));
const WatermarkRemoval = lazyWithRetry(() => import("@/pages/watermark-removal"));
const AudioCleanup = lazyWithRetry(() => import("@/pages/audio-cleanup"));
const Analytics = lazyWithRetry(() => import("@/pages/analytics"));
const MediaImport = lazyWithRetry(() => import("@/pages/import"));
const LogoMaker = lazyWithRetry(() => import("@/pages/logo-maker"));
const BrandingKit = lazyWithRetry(() => import("@/pages/branding-kit"));
const ViralityCheck = lazyWithRetry(() => import("@/pages/virality-check"));
const AnalyticsHub = lazyWithRetry(() => import("@/pages/analytics-hub"));
const SetlistBuilder = lazyWithRetry(() => import("@/pages/setlist"));
const IntrosOutros = lazyWithRetry(() => import("@/pages/intros-outros"));
const StreamPack = lazyWithRetry(() => import("@/pages/stream-pack"));
const CopyrightAssistant = lazyWithRetry(() => import("@/pages/copyright"));
const LlcGuide = lazyWithRetry(() => import("@/pages/llc-guide"));
const Features = lazyWithRetry(() => import("@/pages/features"));
const Promote = lazyWithRetry(() => import("@/pages/promote"));
const GoLive = lazyWithRetry(() => import("@/pages/go-live"));
const DiscordBot = lazyWithRetry(() => import("@/pages/discord-bot"));
const Guides = lazyWithRetry(() => import("@/pages/guides"));
const ClipMaker = lazyWithRetry(() => import("@/pages/clip-maker"));
const BrandingShop = lazyWithRetry(() => import("@/pages/branding-shop"));
const NfcCards = lazyWithRetry(() => import("@/pages/nfc-cards"));
const JewelryShop = lazyWithRetry(() => import("@/pages/jewelry-shop"));
const NfcCardProfile = lazyWithRetry(() => import("@/pages/nfc-card-profile"));
const ReviewPage = lazyWithRetry(() => import("@/pages/review"));
const Settings = lazyWithRetry(() => import("@/pages/settings"));
const ThumbnailMaker = lazyWithRetry(() => import("@/pages/thumbnail-maker"));
const Merch = lazyWithRetry(() => import("@/pages/merch"));
const PlaylistPitcher = lazyWithRetry(() => import("@/pages/playlist-pitch"));
const LabelPitch = lazyWithRetry(() => import("@/pages/label-pitch"));
const ChannelAudit = lazyWithRetry(() => import("@/pages/audit"));
const Contracts = lazyWithRetry(() => import("@/pages/contracts"));
const Movies = lazyWithRetry(() => import("@/pages/movies"));
const WebsiteBuilder = lazyWithRetry(() => import("@/pages/website-builder"));
const MediaDetector = lazyWithRetry(() => import("@/pages/media-detector"));
const SponsorshipOutreach = lazyWithRetry(() => import("@/pages/outreach"));
const Shoutouts = lazyWithRetry(() => import("@/pages/shoutouts"));
const ReleaseChecklist = lazyWithRetry(() => import("@/pages/release"));
const JewelryStudio = lazyWithRetry(() => import("@/pages/jewelry"));
const Gamers = lazyWithRetry(() => import("@/pages/gamers"));
/* ── Orphaned feature pages wired up (site organization) ── */
const CaptionStyler = lazyWithRetry(() => import("@/pages/caption-styler"));
const CoverArt = lazyWithRetry(() => import("@/pages/cover-art"));
const LyricVideo = lazyWithRetry(() => import("@/pages/lyric-video"));
const Translate = lazyWithRetry(() => import("@/pages/translate"));
const ScriptWriter = lazyWithRetry(() => import("@/pages/script-writer"));
const Repurpose = lazyWithRetry(() => import("@/pages/repurpose"));
const Trends = lazyWithRetry(() => import("@/pages/trends"));
const ThumbnailTest = lazyWithRetry(() => import("@/pages/thumbnail-test"));
const VocalRemoval = lazyWithRetry(() => import("@/pages/vocal-removal"));
const Voiceover = lazyWithRetry(() => import("@/pages/voiceover"));
const PressKit = lazyWithRetry(() => import("@/pages/press-kit"));
const PressPublic = lazyWithRetry(() => import("@/pages/press-public"));
const EmailList = lazyWithRetry(() => import("@/pages/email-list"));
const Collabs = lazyWithRetry(() => import("@/pages/collabs"));
const Sponsors = lazyWithRetry(() => import("@/pages/sponsors"));
const SponsorPost = lazyWithRetry(() => import("@/pages/sponsors-post"));
const SponsorDealDetail = lazyWithRetry(() => import("@/pages/sponsor-deal-detail"));
const SponsorDashboard = lazyWithRetry(() => import("@/pages/sponsor-dashboard"));
const Contests = lazyWithRetry(() => import("@/pages/contests"));
const Titles = lazyWithRetry(() => import("@/pages/titles"));
const Community = lazyWithRetry(() => import("@/pages/community"));
const Mastering = lazyWithRetry(() => import("@/pages/mastering"));
const MixMaster = lazyWithRetry(() => import("@/pages/mix-master"));
const Stems = lazyWithRetry(() => import("@/pages/stems"));
const Sfx = lazyWithRetry(() => import("@/pages/sfx"));
const Samples = lazyWithRetry(() => import("@/pages/samples"));
const Podcast = lazyWithRetry(() => import("@/pages/podcast"));
const MyShop = lazyWithRetry(() => import("@/pages/my-shop"));
const Storefronts = lazyWithRetry(() => import("@/pages/storefronts"));
const StorefrontBuilder = lazyWithRetry(() => import("@/pages/storefront-builder"));
const ShopStorefront = lazyWithRetry(() => import("@/pages/shop"));
const Beats = lazyWithRetry(() => import("@/pages/beats"));
const BeatMaker = lazyWithRetry(() => import("@/pages/beat-maker"));
const Hub = lazyWithRetry(() => import("@/pages/hub"));
const LiveShopping = lazyWithRetry(() => import("@/pages/live-shopping"));
const Memberships = lazyWithRetry(() => import("@/pages/memberships"));
const Royalties = lazyWithRetry(() => import("@/pages/royalties"));
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
          <div className="sticky top-0 z-40">
            <VideoBanner />
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
        {typeof window !== "undefined" && <OnboardingTour />}      </div>
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
          <Route path="/waitlist"><Waitlist /></Route>
          <Route path="/extension"><Extension /></Route>
          <Route path="/download"><Download /></Route>
          <Route path="/templates"><TemplatesHub /></Route>
          <Route path="/templates/thumbnails"><ThumbnailTemplates /></Route>
          <Route path="/templates/hooks"><HookTemplates /></Route>
          <Route path="/templates/captions"><CaptionPacks /></Route>
          <Route path="/showcase"><Showcase /></Route>
          <Route path="/showcase/:slug"><ShowcaseItemPage /></Route>
          <Route path="/plan/:slug"><PlanPublic /></Route>
          <Route path="/beta-access"><BetaAccess /></Route>
          <Route path="/contact"><Contact /></Route>
          <Route path="/terms"><Terms /></Route>
          <Route path="/privacy"><Privacy /></Route>
          <Route path="/refund-policy"><RefundPolicy /></Route>
          <Route path="/randomizer"><Randomizer /></Route>
          <Route path="/hooks"><HookStudio /></Route>
          <Route path="/sounds"><SoundFinder /></Route>
          <Route path="/comment-replies"><CommentReplies /></Route>
          {/* Staging-only fog comparison lab (hidden route, no nav link) */}
          <Route path="/fog-lab"><FogLab /></Route>
          <Route path="/cursor-lab"><CursorLab /></Route>
          <Route path="/tour"><TourPlanner /></Route>
          <Route path="/coach"><MonetizationCoach /></Route>
          <Route path="/brand-calculator"><BrandDealCalculator /></Route>
          <Route path="/academy"><CreatorAcademy /></Route>
          <Route path="/content-calendar"><ContentCalendar /></Route>
          <Route path="/sponsors"><SponsorMarketplace /></Route>
          <Route path="/shows"><ShowFinder /></Route>
          <Route path="/brand-deals"><BrandDealFinder /></Route>
          <Route path="/distribute"><Distribute /></Route>
          <Route path="/presave/:slug"><Presave /></Route>
          <Route path="/upscale"><Upscale /></Route>
          <Route path="/scheduler"><Scheduler /></Route>
          <Route path="/tips"><Tips /></Route>
          <Route path="/tips/:handle"><TipPage /></Route>
          <Route path="/referrals"><Referrals /></Route>
          <Route path="/team"><TeamPage /></Route>
          <Route path="/storefronts"><Storefronts /></Route>
          <Route path="/shop/:slug"><ShopStorefront /></Route>          <Route path="/interview-prep"><InterviewPrep /></Route>          <Route path="/upscale"><Upscale /></Route>
          <Route path="/watermark-removal"><WatermarkRemoval /></Route>
          <Route path="/audio-cleanup"><AudioCleanup /></Route>
          <Route path="/setlist"><SetlistBuilder /></Route>
          <Route path="/analytics"><Analytics /></Route>
          <Route path="/import"><MediaImport /></Route>
          <Route path="/logo-maker"><LogoMaker /></Route>
          <Route path="/branding-kit"><BrandingKit /></Route>
          <Route path="/virality-check"><ViralityCheck /></Route>
          <Route path="/analytics-hub"><AnalyticsHub /></Route>
          <Route path="/intros-outros"><IntrosOutros /></Route>
          <Route path="/stream-pack"><StreamPack /></Route>
          <Route path="/copyright"><CopyrightAssistant /></Route>
          <Route path="/llc-guide"><LlcGuide /></Route>
          {/* Public press kit view + email-list join landing (fan-facing) */}
          <Route path="/press/:id"><PressPublic /></Route>
          <Route path="/join/:handle"><Join /></Route>
          <Route path="/features"><Features /></Route>
          <Route path="/promote"><Promote /></Route>
          <Route path="/guides"><Guides /></Route>
          <Route path="/clip-maker"><ClipMaker /></Route>
          <Route path="/branding-shop"><BrandingShop /></Route>
          <Route path="/nfc-cards"><NfcCards /></Route>
          <Route path="/jewelry-shop"><JewelryShop /></Route>
          {/* Public NFC smart-card profile (tap/QR destination) */}
          <Route path="/c/:slug"><NfcCardProfile /></Route>
          {/* Public client review page (tokenized, no login) — the client's handshake with the product */}
          <Route path="/review/:token"><ReviewPage /></Route>

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
                <Route path="/make-song"><ProtectedRoute><MakeSong /></ProtectedRoute></Route>
                <Route path="/make-video"><ProtectedRoute><MakeVideo /></ProtectedRoute></Route>
                <Route path="/video-studio"><ProtectedRoute><VideoStudio /></ProtectedRoute></Route>
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
                <Route path="/thumbnail-maker"><ProtectedRoute><ThumbnailMaker /></ProtectedRoute></Route>
                <Route path="/merch"><ProtectedRoute><Merch /></ProtectedRoute></Route>
                <Route path="/playlist-pitch"><ProtectedRoute><PlaylistPitcher /></ProtectedRoute></Route>
                <Route path="/label-pitch"><ProtectedRoute><LabelPitch /></ProtectedRoute></Route>
                <Route path="/channel-audit"><ProtectedRoute><ChannelAudit /></ProtectedRoute></Route>
                <Route path="/contracts"><ProtectedRoute><Contracts /></ProtectedRoute></Route>
                <Route path="/movies"><ProtectedRoute><Movies /></ProtectedRoute></Route>
                <Route path="/website-builder"><ProtectedRoute><WebsiteBuilder /></ProtectedRoute></Route>
                <Route path="/detector"><ProtectedRoute><MediaDetector /></ProtectedRoute></Route>
                <Route path="/sponsorship-outreach"><ProtectedRoute><SponsorshipOutreach /></ProtectedRoute></Route>
                <Route path="/shoutouts"><ProtectedRoute><Shoutouts /></ProtectedRoute></Route>
                <Route path="/release-checklist"><ProtectedRoute><ReleaseChecklist /></ProtectedRoute></Route>
                <Route path="/go-live"><ProtectedRoute><GoLive /></ProtectedRoute></Route>
                <Route path="/discord-bot"><ProtectedRoute><DiscordBot /></ProtectedRoute></Route>
                <Route path="/jewelry"><ProtectedRoute><JewelryStudio /></ProtectedRoute></Route>
                <Route path="/gamers"><ProtectedRoute><Gamers /></ProtectedRoute></Route>
                {/* ── Wired-up orphaned pages (site organization) ── */}
                <Route path="/caption-styler"><ProtectedRoute><CaptionStyler /></ProtectedRoute></Route>
                <Route path="/cover-art"><ProtectedRoute><CoverArt /></ProtectedRoute></Route>
                <Route path="/lyric-video"><ProtectedRoute><LyricVideo /></ProtectedRoute></Route>
                <Route path="/translate"><ProtectedRoute><Translate /></ProtectedRoute></Route>
                <Route path="/script-writer"><ProtectedRoute><ScriptWriter /></ProtectedRoute></Route>
                <Route path="/repurpose"><ProtectedRoute><Repurpose /></ProtectedRoute></Route>
                <Route path="/trends"><ProtectedRoute><Trends /></ProtectedRoute></Route>
                <Route path="/thumbnail-test"><ProtectedRoute><ThumbnailTest /></ProtectedRoute></Route>
                <Route path="/vocal-removal"><ProtectedRoute><VocalRemoval /></ProtectedRoute></Route>
                <Route path="/voiceover"><ProtectedRoute><Voiceover /></ProtectedRoute></Route>
                <Route path="/press-kit"><ProtectedRoute><PressKit /></ProtectedRoute></Route>
                <Route path="/email-list"><ProtectedRoute><EmailList /></ProtectedRoute></Route>
                <Route path="/collabs"><ProtectedRoute><Collabs /></ProtectedRoute></Route>
                <Route path="/sponsors"><ProtectedRoute><Sponsors /></ProtectedRoute></Route>
                <Route path="/sponsors/post"><ProtectedRoute><SponsorPost /></ProtectedRoute></Route>
                <Route path="/sponsors/dashboard"><ProtectedRoute><SponsorDashboard /></ProtectedRoute></Route>
                <Route path="/sponsors/:id"><ProtectedRoute><SponsorDealDetail /></ProtectedRoute></Route>
                <Route path="/contests"><ProtectedRoute><Contests /></ProtectedRoute></Route>
                <Route path="/titles"><ProtectedRoute><Titles /></ProtectedRoute></Route>
                <Route path="/community"><ProtectedRoute><Community /></ProtectedRoute></Route>
                <Route path="/mastering"><ProtectedRoute><Mastering /></ProtectedRoute></Route>
                <Route path="/mix-master"><ProtectedRoute><MixMaster /></ProtectedRoute></Route>
                <Route path="/stems"><ProtectedRoute><Stems /></ProtectedRoute></Route>
                <Route path="/sfx"><ProtectedRoute><Sfx /></ProtectedRoute></Route>
                <Route path="/samples"><ProtectedRoute><Samples /></ProtectedRoute></Route>
                <Route path="/podcast"><ProtectedRoute><Podcast /></ProtectedRoute></Route>
                <Route path="/beats"><ProtectedRoute><Beats /></ProtectedRoute></Route>
                <Route path="/beat-maker"><ProtectedRoute><BeatMaker /></ProtectedRoute></Route>
                <Route path="/hub"><ProtectedRoute><Hub /></ProtectedRoute></Route>
                <Route path="/live-shopping"><ProtectedRoute><LiveShopping /></ProtectedRoute></Route>
                <Route path="/memberships"><ProtectedRoute><Memberships /></ProtectedRoute></Route>
                <Route path="/royalties"><ProtectedRoute><Royalties /></ProtectedRoute></Route>
                <Route path="/my-shop"><ProtectedRoute><MyShop /></ProtectedRoute></Route>
                <Route path="/storefronts/builder"><ProtectedRoute><StorefrontBuilder /></ProtectedRoute></Route>
                <Route path="/clip-maker"><ProtectedRoute><ClipMaker /></ProtectedRoute></Route>
                <Route path="/go-live"><ProtectedRoute><GoLive /></ProtectedRoute></Route>
                <Route path="/discord-bot"><ProtectedRoute><DiscordBot /></ProtectedRoute></Route>
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
                    <CharacterThemeApplier />
                    <AppShell />
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
