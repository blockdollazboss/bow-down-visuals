import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { SocialSignInButtons, type SocialProvider } from "@/components/SocialSignInButtons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { BowTestLogo } from "@/components/BowTestLogo";
import SpotlightPromo from "@/components/SpotlightPromo";
import ExtensionPromoBadge from "@/components/ExtensionPromoBadge";

const schema = (t: (key: string) => string) =>
  z.object({
    displayName: z.string().min(2, t("signup.validationDisplayName")),
    email: z.string().email(t("signup.validationEmail")),
    password: z.string().min(6, t("signup.validationPassword")),
    confirmPassword: z.string(),
    agreeToTerms: z.boolean().refine((v) => v === true, {
      message: t("signup.validationTerms"),
    }),
  }).refine((d) => d.password === d.confirmPassword, {
    message: t("signup.validationPasswordMatch"),
    path: ["confirmPassword"],
  });

export default function Signup() {
  const { t } = useTranslation();
  usePageTitle(t("signup.pageTitle"), t("signup.pageDescription"));
  const { signUp, signInWithProvider, getAccessToken } = useAuth();
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(null);
  const [success, setSuccess] = useState(false);

  type FormSchema = ReturnType<typeof schema>;
  const form = useForm<z.infer<FormSchema>>({
    resolver: zodResolver(schema(t)),
    defaultValues: { displayName: "", email: "", password: "", confirmPassword: "", agreeToTerms: false },
  });

  async function onSubmit(values: z.infer<FormSchema>) {
    setLoading(true);
    setError(null);
    const { error } = await signUp(values.email, values.password, values.displayName);
    if (error) {
      setError(error);
      setLoading(false);
    } else {
      /* Apply referral code if the user arrived via ?ref= */
      try {
        const refCode = localStorage.getItem("bdv_referral_code");
        if (refCode) {
          localStorage.removeItem("bdv_referral_code");
          // Fire-and-forget: don't block signup success on referral
          (async () => {
            try {
              const token = await getAccessToken();
              await fetch("/api/referrals/apply", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ code: refCode }),
              });
            } catch { /* referral is best-effort */ }
          })();
        }
      } catch { /* noop */ }
      setSuccess(true);
      setLoading(false);
    }
  }

  async function onSocialSignUp(provider: SocialProvider) {
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

  if (success) {
    return (
      <div className="min-h-screen flex flex-col relative overflow-hidden no-throne-bg"
        onMouseMove={handleMouseScrub}
      >
        {/* Drone video background — scrub through with your mouse, full brightness */}
        <video
          ref={bgVideoRef}
          src={`${import.meta.env.BASE_URL}videos/signin-drone-bg.mp4`}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
        <main className="flex-1 relative z-10 flex items-center justify-center px-4">
          <div className="w-full max-w-md text-center space-y-6 bg-black/65 backdrop-blur-xl border border-[#c9a84c]/25 rounded-2xl p-8">
            <h1 className="text-4xl font-black text-white">{t("signup.checkEmailTitle")}</h1>
            <p className="text-white/60 text-lg">
              {t("signup.checkEmailDesc")}
            </p>
            <Button onClick={() => setLocation("/login")} className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 font-semibold">
              {t("signup.goToSignIn")}
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const fieldErrors = form.formState.errors;
  const firstError = error
    || fieldErrors.displayName?.message
    || fieldErrors.email?.message
    || fieldErrors.password?.message
    || fieldErrors.confirmPassword?.message
    || fieldErrors.agreeToTerms?.message;

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden no-throne-bg"
      onMouseMove={handleMouseScrub}
    >
      {/* Drone video background — scrub through with your mouse, full brightness */}
      <video
        ref={bgVideoRef}
        src={`${import.meta.env.BASE_URL}videos/signin-drone-bg.mp4`}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      {/* Spotlight Takeover promo — "this spot is for sale" over the video */}
      <SpotlightPromo />
      <ExtensionPromoBadge />
      {/* Stage: video breathing room */}
      <main className="flex-1 relative z-10" aria-hidden />

      {/* Bottom sign-up toolbar */}
      <footer className="relative z-10 border-t border-[#c9a84c]/25 bg-black/65 backdrop-blur-xl px-4 py-3 animate-[fadeSlideIn_0.7s_ease-out_0.2s_both]">
        <div className="mx-auto max-w-5xl">
          {firstError && (
            <p className="mb-2 text-center text-xs text-destructive">
              {firstError}
            </p>
          )}
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex items-center justify-center gap-2 md:gap-3 flex-nowrap">
            {/* Click-to-bow shark: big, hanging over the toolbar into the video */}
            <div className="relative h-11 w-28 shrink-0">
              <div className="absolute -top-20 left-1/2 -translate-x-1/2 scale-125">
                <BowTestLogo />
              </div>
            </div>
            <SocialSignInButtons
              onSignIn={onSocialSignUp}
              loadingProvider={socialLoading}
              mode="signup"
            />
            <div className="hidden sm:block w-px h-8 bg-white/10" aria-hidden />
            <Input
              data-testid="input-display-name"
              type="text"
              aria-label={t("signup.displayNameField")}
              placeholder={t("signup.displayNameField")}
              autoComplete="nickname"
              className="h-9 w-28 md:w-36 text-sm bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25 shrink-0"
              {...form.register("displayName")}
            />
            <Input
              data-testid="input-email"
              type="email"
              aria-label={t("signup.emailField")}
              placeholder={t("signup.emailField")}
              autoComplete="email"
              className="h-9 w-28 md:w-36 text-sm bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25 shrink-0"
              {...form.register("email")}
            />
            <Input
              data-testid="input-password"
              type="password"
              aria-label={t("signup.passwordField")}
              placeholder={t("signup.passwordField")}
              autoComplete="new-password"
              className="h-9 w-28 md:w-32 text-sm bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25 shrink-0"
              {...form.register("password")}
            />
            <Input
              data-testid="input-confirm-password"
              type="password"
              aria-label={t("signup.confirmPasswordField")}
              placeholder={t("signup.confirmPasswordField")}
              autoComplete="new-password"
              className="h-9 w-28 md:w-32 text-sm bg-white/5 border-white/10 focus:border-[#c9a84c]/60 placeholder:text-white/25 shrink-0"
              {...form.register("confirmPassword")}
            />
            <Button data-testid="btn-signup" type="submit" className="h-9 px-6 text-sm font-semibold bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 shadow-[0_0_24px_rgba(201,168,76,0.35)] whitespace-nowrap shrink-0" disabled={loading}>
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("signup.creatingLabel")}</> : t("signup.createAccountButton")}
            </Button>
          </form>
          <div className="mt-2 flex items-center justify-center gap-3 text-xs text-white/45 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                data-testid="input-terms"
                checked={form.watch("agreeToTerms")}
                onCheckedChange={(v) => form.setValue("agreeToTerms", v === true, { shouldValidate: true })}
                className="border-white/20"
              />
              <span>
                {t("signup.agreePrefix")}{" "}
                <Link href="/terms" className="text-[#c9a84c] hover:underline font-medium">
                  {t("signup.termsLink")}
                </Link>{" "}
                {t("signup.agreeAnd")}{" "}
                <Link href="/privacy" className="text-[#c9a84c] hover:underline font-medium">
                  {t("signup.privacyLink")}
                </Link>
              </span>
            </label>
            <span aria-hidden className="text-white/20">·</span>
            <span>
              {t("signup.alreadyHaveAccount")}{" "}
              <Link href="/login" className="text-[#c9a84c] hover:underline font-medium">
                {t("signup.signInLink")}
              </Link>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
