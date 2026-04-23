// ProtectedRoute — gates a route behind authentication. While the auth
// context resolves the initial session we render a thin loading bar to
// avoid flicker.

import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">
        <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.3em]">
          <Loader2 className="w-4 h-4 animate-spin" />
          LOADING SESSION…
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
