import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";

import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import MakeSong from "@/pages/make-song";
import MakeVideo from "@/pages/make-video";
import SongAndVideo from "@/pages/song-and-video";
import PromoClip from "@/pages/promo-clip";
import Thumbnail from "@/pages/thumbnail";
import Pricing from "@/pages/pricing";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/make-song" component={MakeSong} />
      <Route path="/make-video" component={MakeVideo} />
      <Route path="/song-and-video" component={SongAndVideo} />
      <Route path="/promo-clip" component={PromoClip} />
      <Route path="/thumbnail" component={Thumbnail} />
      <Route path="/pricing" component={Pricing} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <SidebarProvider>
            <div className="flex min-h-screen w-full bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
              <AppSidebar />
              <main className="flex-1 w-full overflow-y-auto">
                <Router />
              </main>
            </div>
          </SidebarProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
