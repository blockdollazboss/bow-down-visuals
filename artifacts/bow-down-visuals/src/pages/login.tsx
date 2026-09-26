import { useEffect, useRef, useState } from "react";
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

  const bgVideoRef = useRef<HTMLVideoElement>(null);

  // Scrub the background video with horizontal mouse position.
  const handleMouseScrub = (e: React.MouseEvent) => {
    const video = bgVideoRef.current;
    if (!video || !video.duration || !isFinite(video.duration)) return;
    const ratio = Math.min(Math.max(e.clientX / window.innerWidth, 0), 1);
    const target = ratio * video.duration;
    // Only seek when the change is meaningful to avoid stutter.
    if (Math.abs(video.currentTime - target) > 0.04) {
      video.currentTime = target;
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden"
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
      {/* Dark overlay */}
      <div className="pointer-events-none absolute inset-0 bg-black/40" />
      {/* Logo — the only thing on the page, placed in the golden upper third */}
      <div className="relative z-10 flex flex-col items-center justify-start pt-[12vh] animate-[fadeSlideIn_0.7s_ease-out_both]">
        <img
          src={`${import.meta.env.BASE_URL}logo-static.png`}
          alt="Bow Down Visuals"
          className="h-40 md:h-56 w-auto drop-shadow-[0_15px_35px_rgba(0,0,0,0.9)]"
        />
      </div>
    </div>
  );
}
