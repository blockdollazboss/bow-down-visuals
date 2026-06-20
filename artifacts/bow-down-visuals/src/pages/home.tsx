import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Mic2, Film, PenTool, Image as ImageIcon } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 py-24 md:py-32 text-center relative overflow-hidden">
        <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,rgba(147,51,234,0.15)_0,rgba(0,0,0,0)_50%)]"></div>
        
        <div className="z-10 max-w-4xl mx-auto space-y-8">
          <h1 className="text-5xl md:text-7xl font-black tracking-tight text-white leading-tight">
            Create Songs, Music Videos, and Promo Clips <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-400">With AI</span>
          </h1>
          
          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto">
            Bow Down Visuals helps music creators generate lyrics, hooks, music video ideas, scene prompts, thumbnails, captions, and promo content.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
            <Button asChild size="lg" className="w-full sm:w-auto text-lg h-14 px-8 purple-glow rounded-full">
              <Link href="/dashboard">Start Creating</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto text-lg h-14 px-8 rounded-full border-primary/30 hover:bg-primary/10">
              <Link href="/pricing">View Pricing</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Feature Highlights */}
      <section className="py-20 px-6 bg-secondary/30 border-t border-border/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">The Complete Studio Experience</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, i) => (
              <div key={i} className="p-6 rounded-2xl bg-card border border-card-border hover:border-primary/50 transition-colors group">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary/20 group-hover:purple-glow-sm transition-all">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-2 text-card-foreground">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

const features = [
  {
    title: "AI Songwriter",
    description: "Generate hooks, verses, and full song structures tailored to your genre and mood.",
    icon: Mic2,
  },
  {
    title: "Video Treatments",
    description: "Get cinematic scene-by-scene directors notes for your next music video.",
    icon: Film,
  },
  {
    title: "Promo Packs",
    description: "Instantly create captions, release strategies, and teaser concepts for social media.",
    icon: PenTool,
  },
  {
    title: "Thumbnails",
    description: "Design cover art and thumbnail concepts that grab attention across all platforms.",
    icon: ImageIcon,
  }
];
