import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { SideVideoBanners } from "@/components/SideVideoBanners";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { SocialSignInButtons, type SocialProvider } from "@/components/SocialSignInButtons";
import { OrDivider } from "@/components/GoogleSignInButton";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export default function Login() {
  usePageTitle("Sign In", "Sign in to Bow Down Visuals.");
  const { signIn, signInWithProvider, user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(null);
  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (!authLoading && user) {
      setLocation("/choose-artist");
    }
  }, [authLoading, user, setLocation]);


  async function onSubmit(values: z.infer<typeof schema>) {
    setLoading(true);
    setError(null);
    const { error } = await signIn(values.email, values.password);
    if (error) {
      setError(error);
      setLoading(false);
    } else {
      setLocation("/choose-artist");
    }
  }

  async function onSocialSignIn(provider: SocialProvider) {
    setSocialLoading(provider);
    setError(null);
    /* On success the browser leaves for the provider's consent screen, so
     * this only resolves when something failed before the redirect. */
    const { error } = await signInWithProvider(provider);
    if (error) {
      setError(error);
      setSocialLoading(null);
    }
  }


  async function onResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    const email = resetEmail.trim();
    if (!email) return;
    setResetLoading(true);
    setResetError(null);
    try {
      const client = getSupabase();
      const { error } = await client.auth.resetPasswordForEmail(email);
      if (error) {
        setResetError(error.message);
      } else {
        setResetSent(true);
      }
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 md:px-32 lg:px-40 relative overflow-hidden">
      {/* Golden throne background — throne pinned to top of frame */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover"
        style={{
          backgroundImage: `url(${import.meta.env.BASE_URL}signin-throne-bg.webp)`,
          backgroundPosition: "center top",
        }}
      />
      {/* Dark overlay for readability */}
      <div className="pointer-events-none absolute inset-0 bg-black/60" />
      {/* Logo seated on the throne — absolute positioned over the chair */}
      <div className="pointer-events-none absolute top-[9%] left-1/2 -translate-x-1/2 z-10 animate-[fadeSlideIn_0.7s_ease-out_both]">
        <img
          src={`${import.meta.env.BASE_URL}logo-static.png`}
          alt="Bow Down Visuals"
          className="h-28 md:h-36 w-auto drop-shadow-[0_10px_25px_rgba(0,0,0,0.9)]"
        />
      </div>
      <SideVideoBanners />
      {/* Smooth gradient blend from video edges into the page */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/70 via-transparent to-black/70" />
      <div className="w-full max-w-md space-y-8 relative z-10 animate-[fadeSlideIn_0.7s_ease-out_both]">
        <div className="text-center animate-[fadeSlideIn_0.7s_ease-out_0.1s_both]">
          <p className="text-muted-foreground">Sign in to your creator account</p>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-8 shadow-2xl gold-glow-sm animate-[fadeSlideIn_0.7s_ease-out_0.2s_both] transition-all duration-300 hover:shadow-[0_0_60px_rgba(201,168,76,0.15)]">
          <SocialSignInButtons
            onSignIn={onSocialSignIn}
            loadingProvider={socialLoading}
            mode="signin"
          />
          <OrDivider />

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input data-testid="input-email" type="email" placeholder="you@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input data-testid="input-password" type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
                  {error}
                </div>
              )}

              <Button data-testid="btn-login" type="submit" size="lg" className="w-full gold-glow" disabled={loading}>
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...</> : "Sign In"}
              </Button>
            </form>
          </Form>

          {resetMode ? (
            resetSent ? (
              <div className="mt-6 p-4 rounded-xl border border-primary/25 bg-primary/5 text-center">
                <p className="text-sm text-white/80 font-medium">Check your email for a reset link.</p>
                <button
                  type="button"
                  onClick={() => { setResetMode(false); setResetSent(false); setResetEmail(""); }}
                  className="mt-2 text-sm text-primary hover:underline font-medium"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={onResetSubmit} className="mt-6 space-y-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1.5">Email</p>
                  <Input
                    data-testid="input-reset-email"
                    type="email"
                    placeholder="you@example.com"
                    value={resetEmail}
                    onChange={(e) => { setResetEmail(e.target.value); if (resetError) setResetError(null); }}
                  />
                </div>
                {resetError && (
                  <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
                    {resetError}
                  </div>
                )}
                <Button data-testid="btn-reset-password" type="submit" size="lg" className="w-full gold-glow" disabled={resetLoading}>
                  {resetLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending reset link...</> : "Send Reset Link"}
                </Button>
                <p className="text-center text-sm">
                  <button type="button" onClick={() => setResetMode(false)} className="text-muted-foreground hover:text-white hover:underline font-medium">
                    Back to sign in
                  </button>
                </p>
              </form>
            )
          ) : (
            <p className="mt-6 text-center text-sm">
              <button
                type="button"
                onClick={() => { setResetMode(true); setResetEmail(form.getValues("email")); }}
                className="text-primary hover:underline font-medium"
              >
                Forgot password?
              </button>
            </p>
          )}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link href="/signup" className="text-primary hover:underline font-medium">
              Sign up free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
