import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Coins, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

interface ConfirmRequest {
  cost: number;
  feature: string;
  details?: string;
}

interface CreditConfirmContextValue {
  /** Show a confirmation popup. Resolves true if the user confirms, false if cancelled. */
  confirmSpend: (req: ConfirmRequest) => Promise<boolean>;
}

const CreditConfirmContext = createContext<CreditConfirmContextValue | null>(null);

export function CreditConfirmProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirmSpend = useCallback((req: ConfirmRequest): Promise<boolean> => {
    // If a dialog is already open, reject the new request
    if (resolverRef.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setRequest(req);
    });
  }, []);

  const close = (confirmed: boolean) => {
    setRequest(null);
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
  };

  const balance = profile?.credits ?? 0;
  const affordable = request ? balance >= request.cost : true;

  return (
    <CreditConfirmContext.Provider value={{ confirmSpend }}>
      {children}
      {request && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => close(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm credit spend"
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-primary/30 bg-[#0d0d0f] p-6 shadow-2xl shadow-primary/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 border border-primary/30">
                  <Coins className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-black text-white text-lg leading-tight">Spend Credits?</h3>
                  <p className="text-xs text-white/50">{request.feature}</p>
                </div>
              </div>
              <button
                onClick={() => close(false)}
                className="text-white/40 hover:text-white transition-colors"
                aria-label="Cancel"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {request.details && (
              <p className="text-sm text-white/60 mb-4">{request.details}</p>
            )}

            <div className="rounded-xl bg-white/[0.04] border border-white/10 p-4 mb-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Cost</span>
                <span className="font-black text-primary">{request.cost} credits</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Your balance</span>
                <span className="font-bold text-white">{balance} credits</span>
              </div>
              <div className="flex justify-between text-sm border-t border-white/10 pt-2">
                <span className="text-white/50">After</span>
                <span className={`font-bold ${affordable ? "text-white" : "text-red-400"}`}>
                  {balance - request.cost} credits
                </span>
              </div>
            </div>

            {!affordable && (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 mb-4">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-300">
                  Not enough credits.{" "}
                  <a href="/pricing" className="underline font-bold" onClick={() => close(false)}>
                    Get more credits
                  </a>
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => close(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-primary text-black font-black hover:bg-primary/90"
                onClick={() => close(true)}
                disabled={!affordable}
              >
                Confirm — {request.cost} credits
              </Button>
            </div>
          </div>
        </div>
      )}
    </CreditConfirmContext.Provider>
  );
}

export function useCreditConfirm(): CreditConfirmContextValue {
  const ctx = useContext(CreditConfirmContext);
  if (!ctx) throw new Error("useCreditConfirm must be used within a CreditConfirmProvider");
  return ctx;
}
