import { type ReactNode } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import WittyLoader from "@/components/delight/witty-loader";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <WittyLoader />;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}
