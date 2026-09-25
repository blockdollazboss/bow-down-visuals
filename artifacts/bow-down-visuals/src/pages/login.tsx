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
import { SharkKingEyes } from "@/components/SharkKingEyes";

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
          {/* Shark King + logo lockup — one unit, eyes follow your cursor */}
          <div className="flex flex-col items-center mb-4">
            <SharkKingEyes className="w-28 h-28 md:w-32 md:h-32 -mb-3 relative z-10 drop-shadow-[0_0_25px_rgba(201,168,76,0.35)]" />
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
