import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePageTitle } from "@/hooks/use-page-title";
import { BowTestLogo } from "@/components/BowTestLogo";
import { mediaUrl } from "@/lib/media-cdn";

/* Password reset landing page. The recovery link in the reset email
 * redirects here (redirectTo is set on resetPasswordForEmail); Supabase
 * establishes a recovery session from the link tokens, and this page lets
 * the user set a new password via updateUser. */
export default function ResetPassword() {
  usePageTitle("Reset Password", "Set a new password for your Bow Down Visuals account.");
  const [, setLocation] = useLocation();
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The Supabase client parses the recovery tokens from the URL
        // (hash or PKCE code) on init, so a session here means a valid link.
        const { data: { session } } = await getSupabase().auth.getSession();
        if (!cancelled) setValid(!!session);
      } catch {
        if (!cancelled) setValid(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      const { error } = await getSupabase().auth.updateUser({ password });
      if (error) {
        setError(error.message);
      } else {
        setDone(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const bgVideoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden no-throne-bg">
      <video
        ref={bgVideoRef}
        src={mediaUrl("videos/signin-drone-bg.mp4")}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      <main className="flex-1 relative z-10 flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center space-y-6 bg-black/65 backdrop-blur-xl border border-[#c9a84c]/25 rounded-2xl p-8">
          <div className="flex justify-center">
            <BowTestLogo />
          </div>

          {checking ? (
            <div className="py-8 flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-[#c9a84c]" />
              <p className="text-sm text-white/60">Checking your reset link...</p>
            </div>
          ) : done ? (
            <>
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
              <h1 className="text-2xl font-black text-white">Password Updated</h1>
              <p className="text-white/60 text-sm">
                Your password has been changed. You're signed in — let's get back to creating.
              </p>
              <Button
                onClick={() => setLocation("/choose-artist")}
                className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 font-semibold"
              >
                Continue
              </Button>
            </>
          ) : !valid ? (
            <>
              <XCircle className="h-12 w-12 text-destructive mx-auto" />
              <h1 className="text-2xl font-black text-white">Link Expired or Invalid</h1>
              <p className="text-white/60 text-sm">
                This reset link is no longer valid. Request a new one from the sign-in page.
              </p>
              <Link href="/login">
                <Button className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 font-semibold">
                  Back to Sign In
                </Button>
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-black text-white">Set a New Password</h1>
              <p className="text-white/60 text-sm">Choose a new password for your account.</p>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <form onSubmit={onSubmit} className="space-y-3">
                <Input
                  data-testid="input-new-password"
                  type="password"
                  aria-label="New password"
                  placeholder="New password"
                  autoComplete="new-password"
                  className="h-10 text-sm bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Input
                  data-testid="input-confirm-new-password"
                  type="password"
                  aria-label="Confirm new password"
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  className="h-10 text-sm bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
                <Button
                  data-testid="btn-update-password"
                  type="submit"
                  disabled={loading}
                  className="w-full h-10 font-semibold bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110"
                >
                  {loading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...</>
                  ) : (
                    "Update Password"
                  )}
                </Button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
