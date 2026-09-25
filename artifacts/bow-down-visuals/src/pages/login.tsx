import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { GoogleSignInButton, OrDivider } from "@/components/GoogleSignInButton";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";
import { CheatCodeTerminal, useCheatCodeUnlock } from "@/components/CheatCodeTerminal";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export default function Login() {
  const { signIn, signInWithGoogle, user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  /* Same cursor-tilt + gold-glow treatment as the header brand mark. */
  const logoTilt = useTiltOnHover<HTMLSpanElement>({ maxDeg: 8, maxShift: 6 });

  /* ── Shark King mascot: eyes follow the cursor ── */
  const mascotRef = useRef<HTMLDivElement>(null);
  const [mascotTilt, setMascotTilt] = useState({ x: 0, y: 0 });
  const onMascotMove = useCallback((e: React.MouseEvent) => {
    const el = mascotRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = (e.clientX - cx) / r.width;
    const dy = (e.clientY - cy) / r.height;
    setMascotTilt({ x: Math.max(-1, Math.min(1, dx)), y: Math.max(-1, Math.min(1, dy)) });
  }, []);
  const onMascotLeave = useCallback(() => setMascotTilt({ x: 0, y: 0 }), []);

  /* ── Hidden cheat-code terminal (Konami or type "cheatcode") ── */
  const [terminalOpen, setTerminalOpen] = useState(false);
  useCheatCodeUnlock(useCallback(() => setTerminalOpen(true), []));

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

  async function onGoogleSignIn() {
    setGoogleLoading(true);
    setError(null);
    /* On success the browser leaves for Google's consent screen, so this
     * only resolves when something failed before the redirect. */
    const { error } = await signInWithGoogle();
    if (error) {
      setError(error);
      setGoogleLoading(false);
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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          {/* Shark King mascot — watches your cursor */}
          <div
            ref={mascotRef}
            onMouseMove={onMascotMove}
            onMouseLeave={onMascotLeave}
            className="flex justify-center mb-2"
            aria-hidden
          >
            <img
              src="/shark-king-signin.webp"
              alt=""
              width={160}
              height={160}
              className="w-36 h-36 md:w-40 md:h-40 object-contain drop-shadow-[0_0_25px_rgba(201,168,76,0.35)] transition-transform duration-150 ease-out select-none pointer-events-none"
              style={{
                transform: `translate(${mascotTilt.x * 10}px, ${mascotTilt.y * 8}px) rotate(${mascotTilt.x * 4}deg)`,
              }}
              draggable={false}
            />
          </div>
          <div className="flex justify-center mb-4">
            <span ref={logoTilt} className="inline-block rounded-lg">
              <AnimatedLogo className="w-[320px] max-w-full h-auto" />
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">Sign in to your creator account</p>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-8 shadow-2xl gold-glow-sm">
          <GoogleSignInButton
            onClick={onGoogleSignIn}
            loading={googleLoading}
            label="Continue with Google"
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

      {/* Hidden cheat-code terminal easter egg */}
      {terminalOpen && <CheatCodeTerminal onClose={() => setTerminalOpen(false)} />}
    </div>
  );
}
