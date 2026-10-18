import { useState, type ReactNode } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { loginPathWithNext } from "@/lib/auth-next";
import WittyLoader from "@/components/delight/witty-loader";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [location] = useLocation();
  const search = useSearch();
  const [barcodeDone, setBarcodeDone] = useState(false);

  if (loading || !barcodeDone) {
    return <WittyLoader onComplete={() => setBarcodeDone(true)} />;
  }

  if (!user) {
    /* Carry the destination: the shared builder preserves path + query
       in ?next= so sign-in returns the visitor here (audit §4.2) —
       the same helper the AppShell GuestGate uses. */
    return <Redirect to={loginPathWithNext(location, search)} />;
  }

  return <>{children}</>;
}
