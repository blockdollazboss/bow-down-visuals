import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

/* Mobile page opened by scanning a QR login code.
   Logged-in user confirms to sign in the desktop session. */
export default function QRLoginApprove() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "confirm" | "approving" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (!t) {
      setError("No token in QR code");
      setStatus("error");
      return;
    }
    setToken(t);
    setStatus("confirm");
  }, []);

  const approve = async () => {
    if (!token || !user) return;
    setStatus("approving");
    try {
      const session = await fetch("/api/auth/qr-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, userId: user.id }),
      });
      const data = await session.json();
      if (data.success) {
        setStatus("done");
      } else {
        setError(data.error ?? "Approval failed");
        setStatus("error");
      }
    } catch {
      setError("Network error");
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-sm w-full text-center">
        {!user ? (
          <>
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Please Log In First</h1>
            <p className="text-muted-foreground mb-6 text-sm">
              You need to be logged in on this device to approve the QR sign-in.
            </p>
            <Button onClick={() => setLocation("/login")} className="w-full">
              Go to Login
            </Button>
          </>
        ) : status === "loading" ? (
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        ) : status === "confirm" ? (
          <>
            <h1 className="text-xl font-bold mb-2">Approve Sign-In?</h1>
            <p className="text-muted-foreground mb-6 text-sm">
              A device is requesting to sign in to your Bow Down Visuals account. Approve only if this was you.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setLocation("/")} className="flex-1">
                Deny
              </Button>
              <Button onClick={approve} className="flex-1">
                Approve
              </Button>
            </div>
          </>
        ) : status === "approving" ? (
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        ) : status === "done" ? (
          <>
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Approved!</h1>
            <p className="text-muted-foreground text-sm">Your other device is now signing in.</p>
          </>
        ) : (
          <>
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Something Went Wrong</h1>
            <p className="text-muted-foreground text-sm">{error}</p>
          </>
        )}
      </div>
    </div>
  );
}
