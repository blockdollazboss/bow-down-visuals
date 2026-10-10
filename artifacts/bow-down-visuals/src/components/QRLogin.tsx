import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { QrCode, X, Loader2, CheckCircle } from "lucide-react";
import { QRCodeImage } from "./QRCode";
import { getSupabase } from "@/lib/supabase";

/* QR Login component for the login page.
   Desktop generates a token, shows QR, polls until mobile approves, then
   exchanges the one-time exchange code for a Supabase magic link and
   establishes its own real Supabase session via verifyOtp. */
export function QRLoginButton({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "waiting" | "approved" | "expired" | "error">("loading");
  const [genNonce, setGenNonce] = useState(0);

  useEffect(() => {
    if (!open) return;
    setStatus("loading");
    setToken(null);
    setQrUrl(null);
    fetch("/api/auth/qr-token", { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (data.token) {
          setToken(data.token);
          setQrUrl(data.qrUrl);
          setStatus("waiting");
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }, [open, genNonce]);

  useEffect(() => {
    if (!open || !token || status !== "waiting") return;
    const id = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/qr-token/${token}`);
        const data = await res.json();
        if (data.status === "approved" && data.exchangeCode) {
          setStatus("approved");
          window.clearInterval(id);
          // Exchange the one-time code for a Supabase sign-in link, then
          // establish this device's own session. The exchange code is
          // single-use: a replayed exchange is rejected server-side.
          const exRes = await fetch("/api/auth/qr-exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, exchangeCode: data.exchangeCode }),
          });
          const exData = await exRes.json();
          if (!exRes.ok || !exData.actionLink) {
            setStatus("error");
            return;
          }
          const actionUrl = new URL(exData.actionLink);
          const tokenHash = actionUrl.searchParams.get("token");
          if (!tokenHash) {
            setStatus("error");
            return;
          }
          const { error } = await getSupabase().auth.verifyOtp({
            token_hash: tokenHash,
            type: "email",
          });
          if (error) {
            setStatus("error");
            return;
          }
          setTimeout(() => {
            onSuccess();
            setOpen(false);
          }, 1500);
        } else if (data.status === "expired") {
          setStatus("expired");
          window.clearInterval(id);
        }
      } catch {
        // Keep polling on network errors
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [open, token, status, onSuccess]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Sign in with QR Code"
        aria-label="Sign in with QR Code"
        className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/80 transition-all hover:border-primary/60 hover:bg-primary/10 hover:text-primary shrink-0"
      >
        <QrCode className="h-5 w-5" strokeWidth={1.8} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/80 p-4 pt-[12vh] overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-card border border-primary/30 rounded-2xl p-6 max-w-sm w-full text-center my-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg">Scan to Sign In</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-accent/10 rounded">
                <X className="h-5 w-5" />
              </button>
            </div>

            {status === "loading" && (
              <div className="py-12 flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Generating QR code...</p>
              </div>
            )}

            {status === "waiting" && qrUrl && (
              <>
                <div className="flex justify-center mb-4">
                  <QRCodeImage data={qrUrl} size={220} />
                </div>
                <p className="text-sm text-muted-foreground">
                  Scan with your phone's camera while logged in on your phone
                </p>
                <p className="text-xs text-muted-foreground/60 mt-2">Code expires in 5 minutes</p>
              </>
            )}

            {status === "approved" && (
              <div className="py-12 flex flex-col items-center gap-3">
                <CheckCircle className="h-12 w-12 text-green-500" />
                <p className="font-semibold">Approved! Signing you in...</p>
              </div>
            )}

            {status === "expired" && (
              <div className="py-12">
                <p className="font-semibold mb-2">Code expired</p>
                <button
                  onClick={() => setGenNonce((n) => n + 1)}
                  className="px-4 py-2 rounded-lg bg-primary text-black font-semibold"
                >
                  Generate New Code
                </button>
              </div>
            )}

            {status === "error" && (
              <div className="py-12">
                <p className="text-destructive">Failed to generate code. Try again.</p>
                <button
                  onClick={() => setGenNonce((n) => n + 1)}
                  className="mt-4 px-4 py-2 rounded-lg bg-primary text-black font-semibold"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
