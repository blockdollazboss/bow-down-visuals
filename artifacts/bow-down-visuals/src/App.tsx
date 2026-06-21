import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Loader2 } from "lucide-react";

import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import Dashboard from "@/pages/dashboard";
import MakeSong from "@/pages/make-song";
import MakeVideo from "@/pages/make-video";
import SongAndVideo from "@/pages/song-and-video";
import PromoClip from "@/pages/promo-clip";
import Thumbnail from "@/pages/thumbnail";
import Pricing from "@/pages/pricing";

const queryClient = new QueryClient();

const AUTH_ROUTES = ["/login", "/signup"];

function AppShell() {
  const { loading, user } = useAuth();
  const isAuthPage = AUTH_ROUTES.some(r => window.location.pathname.endsWith(r));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Switch>
      {/* Public auth routes — no sidebar */}
      <Route path="/login">
        {user ? <Redirect to="/dashboard" /> : <Login />}
      </Route>
      <Route path="/signup">
        {user ? <Redirect to="/dashboard" /> : <Signup />}
      </Route>

      {/* Public marketing routes — no sidebar */}
      <Route path="/">
        <Home />
      </Route>
      <Route path="/pricing">
        <Pricing />
      </Route>

      {/* Dashboard — own full-width layout */}
      <Route path="/dashboard">
        <Dashboard />
      </Route>

      {/* Make a Song — own full-width layout */}
      <Route path="/make-song">
        <MakeSong />
      </Route>

      {/* Make a Music Video — own full-width layout */}
      <Route path="/make-video">
        <MakeVideo />
      </Route>

      {/* Make Song + Video — own full-width layout */}
      <Route path="/song-and-video">
        <SongAndVideo />
      </Route>

      {/* Promo Clip Maker — own full-width layout */}
      <Route path="/promo-clip">
        <PromoClip />
      </Route>

      {/* Tool routes — with sidebar */}
      <Route>
        <SidebarProvider>
          <div className="flex min-h-screen w-full bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
            <AppSidebar />
            <main className="flex-1 w-full overflow-y-auto">
              <Switch>
                <Route path="/make-video">
                  <ProtectedRoute><MakeVideo /></ProtectedRoute>
                </Route>
                <Route path="/song-and-video">
                  <ProtectedRoute><SongAndVideo /></ProtectedRoute>
                </Route>
                <Route path="/promo-clip">
                  <ProtectedRoute><PromoClip /></ProtectedRoute>
                </Route>
                <Route path="/thumbnail">
                  <ProtectedRoute><Thumbnail /></ProtectedRoute>
                </Route>
                <Route component={NotFound} />
              </Switch>
            </main>
          </div>
        </SidebarProvider>
      </Route>
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
