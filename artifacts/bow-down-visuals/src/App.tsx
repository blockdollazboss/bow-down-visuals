import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";

import { SiteFooter } from "@/components/layout/footer";
import Home        from "@/pages/home";
import Dashboard   from "@/pages/dashboard";
import MakeSong    from "@/pages/make-song";
import MakeVideo   from "@/pages/make-video";
import SongAndVideo from "@/pages/song-and-video";
import PromoClip   from "@/pages/promo-clip";
import Thumbnail   from "@/pages/thumbnail";
import ArtistVault from "@/pages/artist-vault";
import MyProjects  from "@/pages/my-projects";
import Pricing     from "@/pages/pricing";
import Waitlist    from "@/pages/waitlist";
import Login       from "@/pages/login";
import Signup      from "@/pages/signup";
import NotFound    from "@/pages/not-found";

const queryClient = new QueryClient();

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
      <Switch>
        {/* Auth routes */}
        <Route path="/login"><Login /></Route>
        <Route path="/signup"><Signup /></Route>

        {/* Marketing */}
        <Route path="/"><Home /></Route>
        <Route path="/pricing"><Pricing /></Route>
        <Route path="/waitlist"><Waitlist /></Route>

        {/* Protected app pages */}
        <Route path="/dashboard"><ProtectedRoute><Dashboard /></ProtectedRoute></Route>
        <Route path="/my-projects"><ProtectedRoute><MyProjects /></ProtectedRoute></Route>
        <Route path="/artist-vault"><ProtectedRoute><ArtistVault /></ProtectedRoute></Route>

        {/* Protected tool pages */}
        <Route path="/make-song"><ProtectedRoute><MakeSong /></ProtectedRoute></Route>
        <Route path="/make-video"><ProtectedRoute><MakeVideo /></ProtectedRoute></Route>
        <Route path="/song-and-video"><ProtectedRoute><SongAndVideo /></ProtectedRoute></Route>
        <Route path="/promo-clip"><ProtectedRoute><PromoClip /></ProtectedRoute></Route>
        <Route path="/thumbnail"><ProtectedRoute><Thumbnail /></ProtectedRoute></Route>

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
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppShell />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
