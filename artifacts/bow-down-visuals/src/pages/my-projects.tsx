import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FolderOpen, Music, Video, Film, Image as ImageIcon, Mic2, ArrowRight, Search, Calendar, Copy, Trash2, Archive } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";

/* ─────────────────────────── MOCK DATA ─────────────────────────── */

const MOCK_PROJECTS = [
  { id: 1, title: "On My Way Up", type: "Make Song + Video", icon: Mic2, date: "Jun 18, 2026", credits: 2, tag: "Most Popular", preview: "Full song package — lyrics, hook, verses, bridge, AI music prompt, video treatment, scene breakdown, and promo ideas.", href: "/song-and-video" },
  { id: 2, title: "Late Night Drive", type: "Make a Song", icon: Music, date: "Jun 15, 2026", credits: 1, tag: null, preview: "Song concept, full lyrics, hook, verse 1, verse 2, bridge, outro, AI music prompt, suggested beat style.", href: "/make-song" },
  { id: 3, title: "Midnight Run — Music Video", type: "Make a Music Video", icon: Video, date: "Jun 12, 2026", credits: 1, tag: null, preview: "Cinematic video treatment, scene-by-scene breakdown, AI video prompts, thumbnail concepts, caption pack.", href: "/make-video" },
  { id: 4, title: "Late Night Drive — Promo Pack", type: "Promo Clip Maker", icon: Film, date: "Jun 10, 2026", credits: 1, tag: null, preview: "TikTok clip ideas, Instagram reel concepts, hook clips, caption pack, hashtags, posting strategy.", href: "/promo-clip" },
  { id: 5, title: "On My Way Up — Cover Art", type: "Thumbnail Maker", icon: ImageIcon, date: "Jun 8, 2026", credits: 1, tag: null, preview: "3 thumbnail concepts, color direction, typography notes, background prompts, Midjourney prompts.", href: "/thumbnail" },
];

const TYPE_COLORS: Record<string, string> = {
  "Make Song + Video": "bg-primary/10 text-primary border-primary/20",
  "Make a Song":       "bg-blue-500/10 text-blue-300 border-blue-500/20",
  "Make a Music Video":"bg-purple-500/10 text-purple-300 border-purple-500/20",
  "Promo Clip Maker":  "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  "Thumbnail Maker":   "bg-amber-500/10 text-amber-300 border-amber-500/20",
};

const QUICK_TOOLS = [
  { label: "Make Song + Video", href: "/song-and-video", icon: Mic2, badge: "Popular" },
  { label: "Make a Song",       href: "/make-song",      icon: Music  },
  { label: "Make a Music Video",href: "/make-video",     icon: Video  },
  { label: "Promo Clip Maker",  href: "/promo-clip",     icon: Film   },
  { label: "Thumbnail Maker",   href: "/thumbnail",      icon: ImageIcon },
  { label: "Artist Vault",      href: "/artist-vault",   icon: Archive },
];

export default function MyProjects() {
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState(MOCK_PROJECTS);

  const filtered = projects.filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.type.toLowerCase().includes(search.toLowerCase())
  );

  function deleteProject(id: number) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-purple-600/8 rounded-full blur-[100px]" />
      </div>
      <div className="relative z-10 max-w-5xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-10">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
                <FolderOpen className="h-5 w-5 text-white" />
              </div>
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-2">My Projects</h1>
            <p className="text-white/50 text-lg">All your generated content in one place.</p>
          </div>
          <Link href="/dashboard">
            <Button className="purple-glow gap-2 shrink-0">
              <Mic2 className="h-4 w-4" /> New Project
            </Button>
          </Link>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/25 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="h-11 pl-10 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 rounded-xl"
          />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: "Total Projects", value: projects.length },
            { label: "Songs Made", value: projects.filter(p => p.type.includes("Song")).length },
            { label: "Videos Made", value: projects.filter(p => p.type.includes("Video")).length },
            { label: "Credits Used", value: projects.reduce((a, p) => a + p.credits, 0) },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-center">
              <p className="text-2xl font-black text-white">{stat.value}</p>
              <p className="text-xs text-white/40 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Project list */}
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="h-8 w-8 text-white/20" />
            </div>
            <p className="text-white/40 font-semibold mb-2">{search ? "No projects match your search" : "No projects yet"}</p>
            <p className="text-white/25 text-sm mb-6">Start creating to see your projects here.</p>
            <Link href="/dashboard">
              <Button className="purple-glow gap-2">
                <Mic2 className="h-4 w-4" /> Create your first project
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((project) => (
              <div key={project.id} className="group rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:border-primary/20 hover:bg-primary/[0.02] transition-all p-5 md:p-6">
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                    <project.icon className="h-4.5 w-4.5 text-primary" style={{ height: "1.125rem", width: "1.125rem" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <h3 className="text-base font-bold text-white truncate">{project.title}</h3>
                      {project.tag && (
                        <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-bold">{project.tag}</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge variant="outline" className={`text-[11px] font-semibold border ${TYPE_COLORS[project.type] || "bg-white/5 text-white/40 border-white/10"}`}>
                        {project.type}
                      </Badge>
                      <span className="flex items-center gap-1 text-xs text-white/30">
                        <Calendar className="h-3 w-3" /> {project.date}
                      </span>
                    </div>
                    <p className="text-sm text-white/45 leading-relaxed line-clamp-2">{project.preview}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="flex items-center justify-center h-8 w-8 rounded-lg text-white/30 hover:text-white hover:bg-white/5 transition-colors" title="Copy">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => deleteProject(project.id)} className="flex items-center justify-center h-8 w-8 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/5 transition-colors" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <Link href={project.href}>
                      <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white/50 border border-white/[0.08] hover:text-white hover:border-primary/30 hover:bg-primary/5 transition-colors">
                        Open <ArrowRight className="h-3 w-3" />
                      </button>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quick tools */}
        <div className="mt-12">
          <p className="text-xs font-bold text-white/30 uppercase tracking-wider mb-4">Start a new project</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {QUICK_TOOLS.map((tool) => (
              <Link key={tool.href} href={tool.href}>
                <button className="w-full flex items-center gap-3 p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] text-sm text-white/60 hover:text-white hover:border-primary/30 hover:bg-primary/5 transition-colors text-left">
                  <tool.icon className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-medium">{tool.label}</span>
                  {tool.badge && <Badge className="ml-auto bg-primary/10 text-primary border-primary/20 text-[10px]">{tool.badge}</Badge>}
                </button>
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-white/[0.05] text-center">
          <p className="text-white/20 text-sm">© 2026 Bow Down Visuals. Create the Song. Create the Video. Promote the Release.</p>
        </div>
      </div>
    </div>
  );
}
