import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Coins, ArrowRight } from "lucide-react";

export function OutOfCredits() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 space-y-6 max-w-md mx-auto">
      <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
        <Coins className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-black text-white">You're out of credits</h2>
        <p className="text-muted-foreground text-base">
          Upgrade to keep creating. Plans start at just a few dollars a month.
        </p>
      </div>
      <Link href="/pricing">
        <Button size="lg" className="purple-glow gap-2">
          View Pricing <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  );
}
