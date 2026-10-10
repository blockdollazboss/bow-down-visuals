import { type ReactNode } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import WittyLoader, { useMinLoadTime } from "@/components/delight/witty-loader";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const minTimeDone = useMinLoadTime();

  if (loading || !minTimeDone) {
    return <WittyLoader />;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}
