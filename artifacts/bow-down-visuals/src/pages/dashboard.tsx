import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mic2, Music, Video, Film, Image as ImageIcon,
  Archive, FolderOpen, Mail, ArrowRight,
  ChevronRight, Star
} from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";

/* ─────────────────────────── DATA ─────────────────────────── */

const CARDS = [
  {
    title: "Make Song + Video",
    description:
      "Create lyrics, AI music prompts, video treatments, scene prompts, captions, and promo ideas in one workflow.",
    icon: Mic2,
    href: "/song-and-video",
    featured: true,
    badge: "Most Popular",
    cta: "Start Workflow",
  },
  {
    title: "Make a Song",
    description:
      "Generate song ideas, hooks, verses, lyrics, beat direction, vocal style, and AI music prompts.",
    icon: Music,
    href: "/make-song",
    featured: false,
    cta: "Make a Song",
  },
  {
    title: "Make a Music Video",
    description:
      "Turn lyrics into a cinematic video treatment, scene list, AI video prompts, thumbnails, and captions.",
    icon: Video,
    href: "/make-video",
    featured: false,
    cta: "Make a Video",
  },
  {
    title: "Promo Clip Maker",
    description:
      "Create TikTok, Reel, and YouTube Short ideas for promoting your next release.",
    icon: Film,
    href: "/promo-clip",
    featured: false,
    cta: "Make Promo",
  },
  {
    title: "Thumbnail Maker",
    description:
      "Generate cover art, thumbnail, and visual branding prompts.",
    icon: ImageIcon,
    href: "/thumbnail",
    featured: false,
    cta: "Make Thumbnail",
  },
  {
    title: "Artist Vault",
    description:
      "Save your artist profile once. Voice style, beat style, visual brand — every tool pulls from your vault.",
    icon: Archive,
    href: "/artist-vault",
    featured: false,
    cta: "Open Vault",
  },
  {
    title: "My Projects",
    description:
      "View all your saved songs, videos, promo packs, and thumbnail concepts in one place.",
    icon: FolderOpen,
    href: "/my-projects",
    featured: false,
    cta: "View Projects",
  },
  {
    title: "Join Waitlist",
    description:
      "Get early access, 100 bonus credits, and a locked-in founding rate before the public launch.",
    icon: Mail,
    href: "/waitlist",
    featured: false,
    cta: "Join Waitlist",
    isWaitlist: true,
  },
];


/* ─────────────────────────── CARD ─────────────────────────── */

interface CardData {
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  featured: boolean;
  cta: string;
  badge?: string;
  comingSoon?: boolean;
  isWaitlist?: boolean;
}

function DashboardCard({ card }: { card: CardData }) {
  const inner = (
    <div
      className={`relative group flex flex-col h-full p-7 rounded-2xl border transition-all duration-300 cursor-pointer
        ${card.featured
          ? "bg-primary/10 border-primary/40 shadow-[0_0_35px_rgba(147,51,234,0.15)] hover:shadow-[0_0_50px_rgba(147,51,234,0.25)]"
          : card.comingSoon
          ? "bg-white/[0.015] border-white/[0.05] opacity-60 cursor-default"
          : card.isWaitlist
          ? "bg-white/[0.02] border-white/[0.06] hover:border-primary/25 hover:bg-primary/5"
          : "bg-white/[0.02] border-white/[0.06] hover:border-primary/30 hover:bg-primary/5 hover:-translate-y-0.5"
        }`}
    >
      {/* Featured badge */}
      {card.badge && (
        <div className="absolute -top-3 left-6">
          <Badge className="bg-primary text-white border-0 text-xs font-bold tracking-wide gap-1">
            <Star className="h-2.5 w-2.5" /> {card.badge}
          </Badge>
        </div>
      )}

      {/* Coming soon badge */}
      {card.comingSoon && (
        <div className="absolute top-4 right-4">
          <Badge variant="outline" className="border-white/10 text-white/30 text-xs">
            Soon
          </Badge>
        </div>
      )}

      {/* Icon */}
      <div
        className={`h-13 w-13 rounded-xl flex items-center justify-center mb-6 shrink-0 transition-colors
          ${card.featured
            ? "bg-primary text-white"
            : "bg-white/5 group-hover:bg-primary/15"
          }`}
        style={{ height: "52px", width: "52px" }}
      >
        <card.icon className={`h-6 w-6 ${card.featured ? "text-white" : "text-primary"}`} />
      </div>

      {/* Text */}
      <div className="flex-1 space-y-2">
        <h3 className="text-xl font-bold text-white leading-tight">{card.title}</h3>
        <p className="text-sm text-white/50 leading-relaxed">{card.description}</p>
      </div>

      {/* CTA */}
      <div className="mt-6 flex items-center gap-2">
        {card.comingSoon ? (
          <span className="text-sm text-white/25 font-semibold">{card.cta}</span>
        ) : (
          <span
            className={`text-sm font-semibold flex items-center gap-1.5 transition-colors
              ${card.featured
                ? "text-white group-hover:text-purple-200"
                : "text-primary group-hover:text-purple-300"
              }`}
          >
            {card.cta}
            <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
          </span>
        )}
      </div>
    </div>
  );

  if (card.comingSoon) return <div>{inner}</div>;
  return <Link href={card.href}>{inner}</Link>;
}

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-purple-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-5 md:px-8 py-12 md:py-16">

        {/* Page header */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-1 w-8 bg-primary rounded-full" />
            <span className="text-xs font-bold tracking-widest text-primary/70 uppercase">Creator Studio</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">
            Creator Dashboard
          </h1>
          <p className="text-white/50 text-lg max-w-xl">
            Start your next song, visual, promo pack, or release idea.
          </p>
        </div>

        {/* Quick-action row */}
        <div className="flex flex-wrap items-center gap-3 mb-10">
          <Link href="/song-and-video">
            <Button className="purple-glow font-semibold gap-2 rounded-full">
              <Mic2 className="h-4 w-4" /> Make Song + Video
            </Button>
          </Link>
          <Link href="/make-song">
            <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10 rounded-full gap-2">
              <Music className="h-4 w-4" /> Make a Song
            </Button>
          </Link>
          <Link href="/make-video">
            <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10 rounded-full gap-2">
              <Video className="h-4 w-4" /> Make a Video
            </Button>
          </Link>
        </div>

        {/* Cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {CARDS.map((card) => (
            <DashboardCard key={card.title} card={card} />
          ))}
        </div>

      </div>
    </div>
  );
}
