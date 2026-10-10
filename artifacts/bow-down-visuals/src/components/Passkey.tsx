import { useEffect, useState } from "react";
import { Fingerprint, Loader2, Trash2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

function base64urlToBuffer(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  // atob tolerates missing padding in most browsers, but restore it to be safe.
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

function bufferToBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Convert a PublicKeyCredential to the JSON format SimpleWebAuthn expects. */
function credentialToJSON(credential: PublicKeyCredential): any {
  const response = credential.response as AuthenticatorAttestationResponse | AuthenticatorAssertionResponse;
  const json: any = {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
    },
  };
  if ("attestationObject" in response) {
    json.response.attestationObject = bufferToBase64url(response.attestationObject);
    // transports is optional; include when available
    const transports = (response as AuthenticatorAttestationResponse).getTransports?.();
    if (transports) json.response.transports = transports;
  }
  if ("authenticatorData" in response) {
    const r = response as AuthenticatorAssertionResponse;
    json.response.authenticatorData = bufferToBase64url(r.authenticatorData);
    json.response.signature = bufferToBase64url(r.signature);
    if (r.userHandle) json.response.userHandle = bufferToBase64url(r.userHandle);
  }
  return json;
}

const supported =
  typeof window !== "undefined" &&
  "credentials" in navigator &&
  "create" in navigator.credentials;

/* Passkey login button — full WebAuthn assertion, then establishes a real
   Supabase session via the magic-link action URL (same pattern as QR login). */
export function PasskeyLoginButton({ onSuccess }: { onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async () => {
    setLoading(true);
    setError(null);
    try {
      const optRes = await fetch("/api/auth/webauthn/login-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error ?? "Failed to start");

      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge: base64urlToBuffer(options.challenge),
          rpId: options.rpId,
          timeout: options.timeout,
          userVerification: options.userVerification,
          allowCredentials: options.allowCredentials?.map((c: any) => ({
            ...c,
            id: base64urlToBuffer(c.id),
          })),
        },
      })) as PublicKeyCredential | null;

      if (!credential) throw new Error("No credential returned");

      const verifyRes = await fetch("/api/auth/webauthn/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: credentialToJSON(credential) }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || !result.success || !result.actionLink) {
        throw new Error(result.error ?? "Verification failed");
      }

      // Establish a real Supabase session from the magic-link action URL.
      const actionUrl = new URL(result.actionLink);
      const tokenHash = actionUrl.searchParams.get("token");
      if (!tokenHash) throw new Error("Invalid sign-in link");
      const { error: otpError } = await getSupabase().auth.verifyOtp({
        token_hash: tokenHash,
        /* The server mints a MAGIC LINK via admin.generateLink({ type: "magiclink" }).
         * The verify type must match, or GoTrue rejects the token. */
        type: "magiclink",
      });
      if (otpError) throw new Error("Could not establish session");

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey login failed");
    } finally {
      setLoading(false);
    }
  };

  /* Hooks must all run before any conditional return (Rules of Hooks). */
  if (!supported) return null;

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={login}
        disabled={loading}
        title="Sign in with Passkey"
        aria-label="Sign in with Passkey"
        className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/80 transition-all hover:border-primary/60 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Fingerprint className="h-5 w-5" strokeWidth={1.8} />}
      </button>
      {error && <p className="text-destructive text-xs mt-2 text-center max-w-[76px]">{error}</p>}
    </div>
  );
}

/* Register a passkey for the logged-in user. Requires a Supabase JWT. */
export function PasskeyRegisterButton({ userId, email }: { userId: string; email: string }) {
  const { getAccessToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const register = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You must be signed in");

      const optRes = await fetch("/api/auth/webauthn/register-options", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      });
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error ?? "Failed to start");

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge: base64urlToBuffer(options.challenge),
          rp: options.rp,
          user: {
            ...options.user,
            id: base64urlToBuffer(options.user.id),
          },
          pubKeyCredParams: options.pubKeyCredParams,
          authenticatorSelection: options.authenticatorSelection,
          timeout: options.timeout,
          attestation: options.attestation,
          excludeCredentials: options.excludeCredentials?.map((c: any) => ({
            ...c,
            id: base64urlToBuffer(c.id),
          })),
        },
      })) as PublicKeyCredential | null;

      if (!credential) throw new Error("No credential created");

      const verifyRes = await fetch("/api/auth/webauthn/register-verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          credential: credentialToJSON(credential),
          deviceName: navigator.userAgent.includes("iPhone")
            ? "iPhone"
            : navigator.userAgent.includes("Android")
              ? "Android"
              : "Device",
        }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || !result.success) {
        throw new Error(result.error ?? "Registration failed");
      }

      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return <p className="text-green-500 text-sm">Passkey registered!</p>;
  }

  /* Hooks must all run before any conditional return (Rules of Hooks). */
  if (!supported) return null;

  return (
    <div>
      <button
        type="button"
        onClick={register}
        disabled={loading}
        className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
        <span>{loading ? "Registering..." : "Add Passkey"}</span>
      </button>
      {error && <p className="text-destructive text-xs mt-2">{error}</p>}
    </div>
  );
}

export interface PasskeyInfo {
  credential_id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
}

/* Full passkey manager for the Settings page: list, register, delete. */
export function PasskeyManager() {
  const { user, getAccessToken } = useAuth();
  const [keys, setKeys] = useState<PasskeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supported) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch("/api/auth/webauthn/credentials", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!cancelled && res.ok) setKeys(data.credentials ?? []);
      } catch {
        if (!cancelled) setKeys([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  const remove = async (credentialId: string) => {
    setDeleting(credentialId);
    try {
      const token = await getAccessToken();
      if (!token) return;
      await fetch("/api/auth/webauthn/credentials", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ credentialId }),
      });
      setRefreshNonce((n) => n + 1);
    } finally {
      setDeleting(null);
    }
  };

  /* Hooks must all run before any conditional return (Rules of Hooks). */
  if (!supported) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center">
          <Fingerprint className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Passkeys</h2>
          <p className="text-white/50 text-sm">
            Sign in with your fingerprint or face — no password needed.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-white/40 text-sm flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading passkeys...
          </p>
        ) : keys.length === 0 ? (
          <p className="text-white/40 text-sm">No passkeys yet. Add one below.</p>
        ) : (
          keys.map((k) => (
            <div
              key={k.credential_id}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{k.device_name || "Passkey"}</p>
                <p className="text-white/40 text-xs">
                  Added {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at
                    ? ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(k.credential_id)}
                disabled={deleting === k.credential_id}
                className="p-2 rounded-lg text-white/40 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                title="Remove passkey"
              >
                {deleting === k.credential_id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </div>
          ))
        )}
      </div>

      {user && (
        <div className="mt-4">
          <PasskeyRegisterButton
            key={refreshNonce}
            userId={user.id}
            email={user.email ?? ""}
          />
        </div>
      )}
    </div>
  );
}
