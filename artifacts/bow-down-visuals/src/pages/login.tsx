import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export default function Login() {
  const { signIn, user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
          <div className="flex justify-center mb-6">
            <AnimatedLogo className="w-[320px] max-w-full h-auto" />
          </div>
          <p className="mt-1 text-muted-foreground">Sign in to your creator account</p>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-8 shadow-2xl gold-glow-sm">
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
