import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Mic2, Music, Video, Film, Image as ImageIcon, FolderArchive, Coins } from "lucide-react";

export default function Dashboard() {
  const tools = [
    {
      title: "Make Song + Video",
      description: "The ultimate combo. Generate lyrics and a complete music video treatment together.",
      icon: Mic2,
      href: "/song-and-video",
      highlight: true
    },
    {
      title: "Make a Song",
      description: "Generate song lyrics, hooks, and structure based on your genre and mood.",
      icon: Music,
      href: "/make-song",
    },
    {
      title: "Make a Music Video",
      description: "Create a detailed, scene-by-scene treatment for your next shoot.",
      icon: Video,
      href: "/make-video",
    },
    {
      title: "Promo Clip Maker",
      description: "Plan your social media rollout with teaser concepts and captions.",
      icon: Film,
      href: "/promo-clip",
    },
    {
      title: "Thumbnail Maker",
      description: "Generate compelling thumbnail ideas and cover art concepts.",
      icon: ImageIcon,
      href: "/thumbnail",
    }
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-white mb-2">Creator Hub</h1>
          <p className="text-muted-foreground text-lg">Welcome back. What are we building today?</p>
        </div>
        
        <Card className="w-full md:w-auto bg-card/50 border-primary/20 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Coins className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Available Balance</p>
              <p className="text-2xl font-bold text-white">250 Credits</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tools.map((tool) => (
          <Link key={tool.title} href={tool.href}>
            <Card className={`h-full cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:purple-glow ${tool.highlight ? 'border-primary shadow-[0_0_15px_rgba(147,51,234,0.15)] bg-primary/5' : 'bg-card hover:border-primary/50'}`}>
              <CardHeader>
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center mb-4 ${tool.highlight ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary'}`}>
                  <tool.icon className="h-6 w-6" />
                </div>
                <CardTitle className="text-xl">{tool.title}</CardTitle>
                <CardDescription className="text-sm mt-2 text-muted-foreground/80">{tool.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}

        {/* Coming Soon state for My Projects */}
        <Card className="h-full border-dashed border-border bg-transparent opacity-60">
          <CardHeader>
            <div className="h-12 w-12 rounded-xl flex items-center justify-center mb-4 bg-secondary text-muted-foreground">
              <FolderArchive className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl flex items-center gap-2">
              My Projects
              <span className="text-[10px] uppercase tracking-wider bg-secondary px-2 py-0.5 rounded-full font-bold">Soon</span>
            </CardTitle>
            <CardDescription className="text-sm mt-2">Access your previously generated content and saved ideas.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
