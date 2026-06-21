import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Coins, ArrowRight, Plus, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const IS_DEV = import.meta.env.DEV;

export function OutOfCredits() {
  const { getAccessToken, refreshProfile } = useAuth();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  async function handleAddTestCredits() {
    setAdding(true);
    setDevError(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/dev/add-credits", { method: "POST", headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" })) as { error?: string };
        throw new Error(err.error ?? "Failed to add credits");
      }
      await refreshProfile();
      setAdded(true);
    } catch (err) {
      setDevError(err instanceof Error ? err.message : "Failed");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 space-y-6 max-w-md mx-auto">
      <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
        <Coins className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-3">
        <h2 className="text-2xl font-black text-white">Out of Credits</h2>
        <p className="text-white/60 text-base leading-relaxed">
          You are out of credits.{IS_DEV ? " This is demo mode. Add test credits or join the waitlist." : " Join the waitlist or upgrade soon to keep creating."}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {IS_DEV && (
          <Button
            size="lg"
            onClick={handleAddTestCredits}
            disabled={adding || added}
            className="border border-yellow-500/40 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 gap-2"
            variant="outline"
          >
            {adding ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Adding…</>
            ) : added ? (
              <><Plus className="h-4 w-4" /> Credits Added!</>
            ) : (
              <><Plus className="h-4 w-4" /> Add 10 Test Credits</>
            )}
          </Button>
        )}
        <Link href="/waitlist">
          <Button size="lg" className="gold-glow gap-2">
            Join the Waitlist <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/pricing">
          <Button size="lg" variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2">
            View Pricing
          </Button>
        </Link>
      </div>

      {devError && (
        <p className="text-red-400 text-xs">{devError}</p>
      )}
    </div>
  );
}
