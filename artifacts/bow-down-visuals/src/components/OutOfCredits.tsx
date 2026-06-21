import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Coins, ArrowRight } from "lucide-react";

export function OutOfCredits() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 space-y-6 max-w-md mx-auto">
      <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
        <Coins className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-3">
        <h2 className="text-2xl font-black text-white">Out of Credits</h2>
        <p className="text-white/60 text-base leading-relaxed">
          You are out of credits. Join the waitlist or upgrade soon to keep creating.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <Link href="/waitlist">
          <Button size="lg" className="purple-glow gap-2">
            Join the Waitlist <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/pricing">
          <Button size="lg" variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2">
            View Pricing
          </Button>
        </Link>
      </div>
    </div>
  );
}
