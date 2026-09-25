/**
 * TikTok brand icon.
 *
 * lucide-react v1 removed brand icons, so we ship our own copy of the
 * classic TikTok musical-note glyph with the same stroke-based styling
 * API as lucide icons (`className` for sizing).
 */
export function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9 18a3 3 0 1 1-3-3" />
      <path d="M9 18V4l10-2v11" />
      <path d="M19 15a3 3 0 1 1-3-3" />
    </svg>
  );
}
