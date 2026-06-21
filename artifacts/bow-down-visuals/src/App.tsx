import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

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
    <Switch>
      {/* Auth routes */}
      <Route path="/login"><Login /></Route>
      <Route path="/signup"><Signup /></Route>

      {/* Marketing */}
      <Route path="/"><Home /></Route>
      <Route path="/pricing"><Pricing /></Route>
      <Route path="/waitlist"><Waitlist /></Route>

      {/* App pages */}
      <Route path="/dashboard"><Dashboard /></Route>
      <Route path="/my-projects"><MyProjects /></Route>
      <Route path="/artist-vault"><ArtistVault /></Route>

      {/* Tool pages */}
      <Route path="/make-song"><MakeSong /></Route>
      <Route path="/make-video"><MakeVideo /></Route>
      <Route path="/song-and-video"><SongAndVideo /></Route>
      <Route path="/promo-clip"><PromoClip /></Route>
      <Route path="/thumbnail"><Thumbnail /></Route>

      <Route component={NotFound} />
    </Switch>
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
