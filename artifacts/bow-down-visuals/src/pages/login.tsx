import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { SocialSignInButtons, type SocialProvider } from "@/components/SocialSignInButtons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import { BowTestLogo } from "@/components/BowTestLogo";

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

  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const scrubTarget = useRef<number | null>(null);
  const scrubRaf = useRef<number>(0);

  // Pro-grade mouse scrub: 1:1 tracking, frame-throttled so seeks never stutter.
  // Uses fastSeek() where available (built for scrubbing) with dense
  // keyframes in the source file for near-instant seeks.
  useEffect(() => {
    const tick = () => {
      const video = bgVideoRef.current;
      const target = scrubTarget.current;
      if (video && target !== null && video.duration && isFinite(video.duration) && video.readyState >= 2) {
        if (Math.abs(video.currentTime - target) > 0.02) {
          const v = video as HTMLVideoElement & { fastSeek?: (t: number) => void };
          if (typeof v.fastSeek === "function") v.fastSeek(target);
          else video.currentTime = target;
        }
      }
      scrubRaf.current = requestAnimationFrame(tick);
    };
    scrubRaf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(scrubRaf.current);
  }, []);

  const handleMouseScrub = (e: React.MouseEvent) => {
    const video = bgVideoRef.current;
    if (!video || !video.duration || !isFinite(video.duration)) return;
    const ratio = Math.min(Math.max(e.clientX / window.innerWidth, 0), 1);
    scrubTarget.current = ratio * video.duration;
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden"
      onMouseMove={handleMouseScrub}
    >
      {/* Drone video background — scrub through with your mouse */}
      <video
        ref={bgVideoRef}
        src={`${import.meta.env.BASE_URL}videos/signin-drone-bg.mp4`}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      {/* Cinematic vignette + dark overlay for readability */}
      <div className="pointer-events-none absolute inset-0 bg-black/55" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.55)_100%)]" />
      {/* Stage: video breathing room */}
      <main className="flex-1 relative z-10" aria-hidden />

      {/* Bottom sign-in toolbar */}
      <footer className="relative z-10 border-t border-[#c9a84c]/25 bg-black/65 backdrop-blur-xl px-4 py-3 animate-[fadeSlideIn_0.7s_ease-out_0.2s_both]">
        <div className="mx-auto max-w-4xl">
          {(error || form.formState.errors.email || form.formState.errors.password) && !resetMode && (
            <p className="mb-2 text-center text-xs text-destructive">
              {error || form.formState.errors.email?.message || form.formState.errors.password?.message}
            </p>
          )}
          {resetMode ? (
            resetSent ? (
              <div className="flex items-center justify-center gap-3 text-sm">
                <p className="text-white/80">Check your email for a reset link.</p>
                <button
                  type="button"
                  onClick={() => { setResetMode(false); setResetSent(false); setResetEmail(""); }}
                  className="text-[#c9a84c] hover:underline font-medium"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={onResetSubmit} className="flex items-center justify-center gap-2 flex-wrap">
                <Input
                  data-testid="input-reset-email"
                  type="email"
                  aria-label="Email"
                  placeholder="you@example.com"
                  className="h-9 w-56 text-sm bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25"
                  value={resetEmail}
                  onChange={(e) => { setResetEmail(e.target.value); if (resetError) setResetError(null); }}
                />
                {resetError && <span className="text-xs text-destructive">{resetError}</span>}
                <Button data-testid="btn-reset-password" type="submit" className="h-9 text-sm font-semibold bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110" disabled={resetLoading}>
                  {resetLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</> : "Send Reset Link"}
                </Button>
                <button type="button" onClick={() => setResetMode(false)} className="text-xs text-white/50 hover:text-white hover:underline font-medium">
                  Back to sign in
                </button>
              </form>
            )
          ) : (
            <>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex items-center justify-center gap-2 md:gap-3 flex-wrap">
                <SocialSignInButtons
                  onSignIn={onSocialSignIn}
                  loadingProvider={socialLoading}
                  mode="signin"
                />
                {/* Click-to-bow shark: big, hanging over the toolbar into the video */}
                <div className="relative h-11 w-24 shrink-0">
                  <div className="absolute -top-[4.5rem] left-1/2 -translate-x-1/2">
                    <BowTestLogo />
                  </div>
                </div>
                <div className="hidden sm:block w-px h-8 bg-white/10" aria-hidden />
                <Input
                  data-testid="input-email"
                  type="email"
                  aria-label="Email"
                  placeholder="Email"
                  autoComplete="email"
                  className="h-9 w-40 md:w-52 text-sm bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25"
                  {...form.register("email")}
                />
                <Input
                  data-testid="input-password"
                  type="password"
                  aria-label="Password"
                  placeholder="Password"
                  autoComplete="current-password"
                  className="h-9 w-40 md:w-52 text-sm bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25"
                  {...form.register("password")}
                />
                <Button data-testid="btn-login" type="submit" className="h-9 px-6 text-sm font-semibold bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 shadow-[0_0_24px_rgba(201,168,76,0.35)]" disabled={loading}>
                  {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...</> : "Sign In"}
                </Button>
              </form>
              <div className="mt-2 flex items-center justify-center gap-3 text-xs text-white/45">
                <button
                  type="button"
                  onClick={() => { setResetMode(true); setResetEmail(form.getValues("email")); }}
                  className="text-[#c9a84c]/80 hover:text-[#c9a84c] hover:underline font-medium"
                >
                  Forgot password?
                </button>
                <span aria-hidden className="text-white/20">·</span>
                <span>
                  Don't have an account?{" "}
                  <Link href="/signup" className="text-[#c9a84c] hover:underline font-medium">
                    Sign up free
                  </Link>
                </span>
              </div>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
