/**
 * Brand icons for Bow Down Visuals' social channels.
 * Inline SVGs (lucide-react no longer ships brand icons).
 * All use currentColor so they inherit text color.
 */
export { InstagramIcon } from "@/components/ui/instagram-icon";
import { InstagramIcon } from "@/components/ui/instagram-icon";

type IconProps = { className?: string };

export function TikTokIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );
}

export function YouTubeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </svg>
  );
}

export const SOCIAL_HANDLE = "@bowdownvisuals";

/** Upload/share destinations. Instagram has no web upload intent, so it opens the app homepage. */
export const SOCIAL_SHARE_TARGETS = [
  { label: "Instagram", href: "https://www.instagram.com/", Icon: InstagramIcon },
  { label: "TikTok", href: "https://www.tiktok.com/upload", Icon: TikTokIcon },
  { label: "YouTube", href: "https://www.youtube.com/upload", Icon: YouTubeIcon },
];
