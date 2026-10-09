import { useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";

function base64urlToBuffer(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

function bufferToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/* Passkey login button - uses WebAuthn for biometric login */
export function PasskeyLoginButton({ onSuccess }: { onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported =
    typeof window !== "undefined" &&
    "credentials" in navigator &&
    "create" in navigator.credentials;

  if (!supported) return null;

  const login = async () => {
    setLoading(true);
    setError(null);
    try {
      // Get challenge from server
      const optRes = await fetch("/api/auth/webauthn/login-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error ?? "Failed to start");

      // Ask the authenticator
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

      const response = credential.response as AuthenticatorAssertionResponse;

      // Verify with server
      const verifyRes = await fetch("/api/auth/webauthn/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialId: credential.id,
          authenticatorData: bufferToBase64url(response.authenticatorData),
          clientDataJSON: bufferToBase64url(response.clientDataJSON),
          signature: bufferToBase64url(response.signature),
        }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || !result.success) {
        throw new Error(result.error ?? "Verification failed");
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <button
        onClick={login}
        disabled={loading}
        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
        <span>{loading ? "Verifying..." : "Sign in with Passkey"}</span>
      </button>
      {error && <p className="text-destructive text-xs mt-2 text-center">{error}</p>}
    </div>
  );
}

/* Register a passkey for the logged-in user */
export function PasskeyRegisterButton({ userId, email }: { userId: string; email: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported =
    typeof window !== "undefined" &&
    "credentials" in navigator &&
    "create" in navigator.credentials;

  if (!supported) return null;

  const register = async () => {
    setLoading(true);
    setError(null);
    try {
      const optRes = await fetch("/api/auth/webauthn/register-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, email }),
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

      const response = credential.response as AuthenticatorAttestationResponse;

      const verifyRes = await fetch("/api/auth/webauthn/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          credentialId: credential.id,
          attestationObject: bufferToBase64url(response.attestationObject),
          clientDataJSON: bufferToBase64url(response.clientDataJSON),
          deviceName: navigator.userAgent.includes("iPhone") ? "iPhone" : "Device",
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
    return <p className="text-green-500 text-sm text-center">Passkey registered!</p>;
  }

  return (
    <div>
      <button
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
