import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export type SocialProvider = "google" | "facebook" | "twitter" | "apple" | "discord";

const PROVIDER_META: Record<
  SocialProvider,
  { label: string; mark: (props: { className?: string }) => React.ReactElement }
> = {
  google: { label: "Google", mark: GoogleGMark },
  facebook: { label: "Facebook", mark: FacebookMark },
  twitter: { label: "X", mark: XMark },
  apple: { label: "Apple", mark: AppleMark },
  discord: {
    label: "Discord",
    mark: ({ className = "h-5 w-5" }) => (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#5865F2"
          d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51 13.78 13.78 0 0 0-.64 1.28 18.27 18.27 0 0 0-5.5 0 12.64 12.64 0 0 0-.64-1.28h-.05A19.74 19.74 0 0 0 3.64 4.37 20.15 20.15 0 0 0 .11 18.06a19.9 19.9 0 0 0 6.04 3.03c.46-.63.87-1.3 1.22-2a12.9 12.9 0 0 1-1.93-.92c.16-.12.32-.24.47-.37a14.2 14.2 0 0 0 12.18 0c.15.13.31.25.47.37-.61.36-1.26.68-1.93.92.35.7.76 1.37 1.22 2a19.84 19.84 0 0 0 6.04-3.03 20.02 20.02 0 0 0-3.57-13.69ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42s.95-2.42 2.16-2.42 2.18 1.09 2.16 2.42c0 1.34-.95 2.42-2.16 2.42Zm7.96 0c-1.18 0-2.16-1.08-2.16-2.42s.95-2.42 2.16-2.42 2.18 1.09 2.16 2.42c0 1.34-.95 2.42-2.16 2.42Z"
        />
      </svg>
    ),
  },
};

interface SocialSignInButtonsProps {
  onSignIn: (provider: SocialProvider) => void;
  loadingProvider: SocialProvider | null;
  mode: "signin" | "signup";
  /** Providers to show. Discord login is wired by the discord-bot build; include it and it will work once enabled. */
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
  providers = ["google", "discord", "facebook", "twitter", "apple"],
}: SocialSignInButtonsProps) {
  const verb = mode === "signin" ? "Continue with" : "Sign up with";
  return (
    <div className="grid grid-cols-1 gap-2.5">
      {providers.map((provider) => {
        const meta = PROVIDER_META[provider];
        const Mark = meta.mark;
        const loading = loadingProvider === provider;
        return (
          <Button
            key={provider}
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => onSignIn(provider)}
            disabled={loadingProvider !== null}
            data-testid={`btn-${provider}-signin`}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Mark className="mr-2 h-5 w-5" />
            )}
            {verb} {meta.label}
          </Button>
        );
      })}
    </div>
  );
}
