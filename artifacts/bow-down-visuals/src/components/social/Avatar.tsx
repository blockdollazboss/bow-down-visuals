import { Link } from "wouter";
import { BadgeCheck } from "lucide-react";
import type { SocialAuthor } from "@/lib/social-api";
import { profileHref } from "@/lib/social-api";

/* Every avatar links to the creator's profile. Verified = gold check. */
export function Avatar({
  author,
  size = 44,
  showBadge = true,
  ring = false,
}: {
  author: SocialAuthor | null | undefined;
  size?: number;
  showBadge?: boolean;
  ring?: boolean;
}) {
  const initial = (author?.display_name?.[0] ?? "?").toUpperCase();
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <Link
        href={profileHref(author)}
        aria-label={author ? `View ${author.display_name}'s profile` : "View profile"}
        className={`block overflow-hidden rounded-full bg-[#1a1a1a] ${
          ring ? "p-[2.5px] bg-gradient-to-tr from-[#d4af37] via-[#f5e08c] to-[#b8860b]" : ""
        }`}
        style={{ width: size, height: size }}
      >
        <span
          className="block h-full w-full overflow-hidden rounded-full bg-[#1a1a1a]"
          style={ring ? { width: size - 5, height: size - 5 } : undefined}
        >
          {author?.avatar_url ? (
            <img src={author.avatar_url} alt={author.display_name} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[#d4af37] font-bold" style={{ fontSize: size * 0.42 }}>
              {initial}
            </span>
          )}
        </span>
      </Link>
      {showBadge && author?.is_verified && (
        <BadgeCheck
          className="absolute -bottom-0.5 -right-0.5 text-[#d4af37]"
          style={{ width: size * 0.38, height: size * 0.38, background: "#0a0a0a", borderRadius: "50%" }}
          aria-label="Verified creator"
        />
      )}
    </span>
  );
}
