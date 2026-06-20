import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic2, Music, Video, Film, Image as ImageIcon, FolderOpen, Coins, Clock, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";

interface Project {
  id: string;
  project_type: string;
  artist_name: string | null;
  song_title: string | null;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  song: "Song",
  video: "Music Video",
  "song-video": "Song + Video",
  promo: "Promo Clip",
  thumbnail: "Thumbnail",
};

const TYPE_ICONS: Record<string, typeof Music> = {
  song: Music,
  video: Video,
  "song-video": Mic2,
  promo: Film,
  thumbnail: ImageIcon,
};

const tools = [
  { title: "Make Song + Video", description: "Generate lyrics + a complete music video treatment together.", icon: Mic2, href: "/song-and-video", highlight: true },
  { title: "Make a Song", description: "Generate song lyrics, hooks, and structure based on your genre and mood.", icon: Music, href: "/make-song" },
  { title: "Make a Music Video", description: "Create a detailed, scene-by-scene treatment for your next shoot.", icon: Video, href: "/make-video" },
  { title: "Promo Clip Maker", description: "Plan your social media rollout with teaser concepts and captions.", icon: Film, href: "/promo-clip" },
  { title: "Thumbnail Maker", description: "Generate compelling thumbnail ideas and cover art concepts.", icon: ImageIcon, href: "/thumbnail" },
];

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Dashboard() {
  const { profile, user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function fetchProjects() {
      try {
        const sb = getSupabase();
        const { data } = await sb
          .from("projects")
          .select("id, project_type, artist_name, song_title, created_at")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false })
          .limit(6);
        setProjects(data ?? []);
      } catch {
        // silently fail
      } finally {
        setLoadingProjects(false);
      }
    }
    fetchProjects();
  }, [user]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-white mb-2">Creator Hub</h1>
          <p className="text-muted-foreground text-lg">
            Welcome back{profile?.display_name ? `, ${profile.display_name}` : ""}. What are we building today?
          </p>
        </div>

        <Card className="w-full md:w-auto bg-card/50 border-primary/20 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Coins className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Available Balance</p>
              <p className="text-2xl font-bold text-white">
                {profile?.credits ?? "—"} Credits
              </p>
            </div>
            <Badge variant="outline" className="border-primary/30 text-primary capitalize ml-2">
              {profile?.plan ?? "starter"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Tool cards */}
      <section>
        <h2 className="text-lg font-bold text-white mb-4">Create</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tools.map((tool) => (
            <Link key={tool.title} href={tool.href}>
              <Card data-testid={`card-tool-${tool.href.replace("/", "")}`} className={`h-full cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:purple-glow ${tool.highlight ? "border-primary shadow-[0_0_15px_rgba(147,51,234,0.15)] bg-primary/5" : "bg-card hover:border-primary/50"}`}>
                <CardHeader>
                  <div className={`h-12 w-12 rounded-xl flex items-center justify-center mb-4 ${tool.highlight ? "bg-primary text-primary-foreground" : "bg-secondary text-primary"}`}>
                    <tool.icon className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-xl">{tool.title}</CardTitle>
                  <CardDescription className="text-sm mt-2 text-muted-foreground/80">{tool.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* My Projects */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">My Projects</h2>
          {projects.length > 0 && (
            <span className="text-xs text-muted-foreground">{projects.length} recent</span>
          )}
        </div>

        {loadingProjects ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <Card className="border-dashed border-border bg-transparent">
            <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
              <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                <FolderOpen className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">No saved projects yet.</p>
              <p className="text-sm text-muted-foreground/70">Generate something and click <strong className="text-white">Save Project</strong> to store it here.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => {
              const Icon = TYPE_ICONS[project.project_type] ?? Music;
              return (
                <Card key={project.id} data-testid={`card-project-${project.id}`} className="bg-card border-border hover:border-primary/40 transition-colors cursor-pointer group">
                  <CardContent className="p-5 flex items-start gap-4">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white truncate">
                        {project.song_title || project.artist_name || "Untitled"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {TYPE_LABELS[project.project_type] ?? project.project_type}
                      </p>
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground/60">
                        <Clock className="h-3 w-3" />
                        {timeAgo(project.created_at)}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0 mt-1" />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
