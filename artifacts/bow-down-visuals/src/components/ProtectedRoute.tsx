import { useState, type ReactNode } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import WittyLoader from "@/components/delight/witty-loader";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [barcodeDone, setBarcodeDone] = useState(false);

  if (loading || !barcodeDone) {
    return <WittyLoader onComplete={() => setBarcodeDone(true)} />;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}
