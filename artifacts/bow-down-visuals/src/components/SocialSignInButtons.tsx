import { Loader2 } from "lucide-react";
import { GoogleGMark } from "./GoogleSignInButton";

/** Facebook "f" mark (inline SVG). */
export function FacebookMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.09 24 18.1 24 12.07z"
      />
    </svg>
  );
}

/** X (Twitter) mark (inline SVG). */
export function XMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41z"
      />
    </svg>
  );
}

/** Apple mark (inline SVG). */
export function AppleMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8.98-.2 1.92-.87 3.03-.83 1.32.11 2.31.63 2.96 1.57-2.71 1.63-2.28 5.21.44 6.28-.6 1.57-1.38 3.13-2.51 4.15M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25"
      />
    </svg>
  );
}

/* Supabase OAuth only supports these providers. Instagram and TikTok are NOT
   valid Supabase OAuth providers — wiring a button to signInWithOAuth with
   them errors out ("Unsupported provider"), so they are intentionally
   absent here. If Instagram/TikTok login is ever wanted, it needs a
   custom server-side OAuth implementation first. */
export type SocialProvider = "google" | "apple" | "facebook";

const PROVIDER_META: Record<
  SocialProvider,
  { label: string; mark: (props: { className?: string }) => React.ReactElement }
> = {
  google: { label: "Google", mark: GoogleGMark },
  apple: { label: "Apple", mark: AppleMark },
  facebook: { label: "Facebook", mark: FacebookMark },
};

interface SocialSignInButtonsProps {
  onSignIn: (provider: SocialProvider) => void;
  loadingProvider: SocialProvider | null;
  mode: "signin" | "signup";
  /** Providers to show. Only providers enabled in the Supabase dashboard work. */
  providers?: SocialProvider[];
}

/**
 * One-click social sign-in buttons. Each delegates to Supabase OAuth —
 * the provider must be enabled in the Supabase dashboard with its
 * client ID/secret configured.
 */
export function SocialSignInButtons({
  onSignIn,
  loadingProvider,
  mode,
  providers = ["google", "apple", "facebook"],
}: SocialSignInButtonsProps) {
  return (
    <div className="flex items-center justify-center gap-3">
      {providers.map((provider) => {
        const meta = PROVIDER_META[provider];
        const Mark = meta.mark;
        const loading = loadingProvider === provider;
        return (
          <button
            key={provider}
            type="button"
            onClick={() => onSignIn(provider)}
            disabled={loadingProvider !== null}
            data-testid={`btn-${provider}-signin`}
            title={meta.label}
            aria-label={`${mode === "signin" ? "Continue" : "Sign up"} with ${meta.label}`}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/80 transition-all hover:border-primary/60 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Mark className="h-5 w-5" />
            )}
          </button>
        );
      })}
    </div>
  );
}
