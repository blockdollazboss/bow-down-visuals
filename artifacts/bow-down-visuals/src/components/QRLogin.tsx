import { useEffect, useState } from "react";
import { QrCode, X, Loader2, CheckCircle } from "lucide-react";
import { QRCodeImage } from "./QRCode";

/* QR Login component for the login page.
   Desktop generates a token, shows QR, polls until mobile approves. */
export function QRLoginButton({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "waiting" | "approved" | "expired" | "error">("loading");

  useEffect(() => {
    if (!open) return;
    setStatus("loading");
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
  }, [open ]);

  useEffect(() => {
    if (!open || !token || status !== "waiting") return;
    const id = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/qr-token/${token}`);
        const data = await res.json();
        if (data.status === "approved") {
          setStatus("approved");
          window.clearInterval(id);
          // Mark consumed and trigger success
          await fetch("/api/auth/qr-consume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
          // The actual session creation happens via Supabase magic link or
          // the mobile device shares a session token. For now, reload to
          // pick up the session if the mobile approval set a cookie.
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
        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
      >
        <QrCode className="h-4 w-4" />
        <span>Sign in with QR Code</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(false)}>
          <div className="bg-card border border-primary/30 rounded-2xl p-6 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
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
                  onClick={() => { setToken(null); setStatus("loading"); }}
                  className="px-4 py-2 rounded-lg bg-primary text-black font-semibold"
                >
                  Generate New Code
                </button>
              </div>
            )}

            {status === "error" && (
              <div className="py-12">
                <p className="text-destructive">Failed to generate code. Try again.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
