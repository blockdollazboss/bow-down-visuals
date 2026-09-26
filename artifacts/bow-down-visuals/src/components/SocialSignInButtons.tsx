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

export type SocialProvider = "google" | "apple" | "instagram" | "facebook" | "tiktok";

const PROVIDER_META: Record<
  SocialProvider,
  { label: string; mark: (props: { className?: string }) => React.ReactElement }
> = {
  google: { label: "Google", mark: GoogleGMark },
  apple: { label: "Apple", mark: AppleMark },
  instagram: {
    label: "Instagram",
    mark: ({ className = "h-5 w-5" }) => (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85 0 3.2-.01 3.58-.07 4.85-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.64.07-4.85.07-3.2 0-3.58-.01-4.85-.07-3.26-.15-4.77-1.7-4.92-4.92-.06-1.27-.07-1.64-.07-4.85 0-3.2.01-3.58.07-4.85.15-3.23 1.66-4.77 4.92-4.92 1.27-.06 1.65-.07 4.85-.07M12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95C23.73 2.7 21.31.27 16.95.07 15.67.01 15.26 0 12 0Zm0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84ZM12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4Zm6.41-11.85a1.44 1.44 0 1 0 1.43 1.44 1.44 1.44 0 0 0-1.43-1.44Z"
        />
      </svg>
    ),
  },
  facebook: { label: "Facebook", mark: FacebookMark },
  tiktok: {
    label: "TikTok",
    mark: ({ className = "h-5 w-5" }) => (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1Z"
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
  providers = ["google", "apple", "instagram", "facebook", "tiktok"],
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
