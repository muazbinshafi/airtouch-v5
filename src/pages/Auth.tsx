// Auth — single page that handles both Sign In and Sign Up via tabs, plus
// Google OAuth. Uses Supabase Cloud Auth.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Hand, Loader2, ArrowRight, Mail, Lock, User as UserIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/AuthContext";
import { toast } from "@/hooks/use-toast";

type Mode = "signin" | "signup";

const Auth = () => {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = mode === "signin" ? "Sign in — OmniPoint" : "Create account — OmniPoint";
  }, [mode]);

  // Already signed in? Send to demo.
  useEffect(() => {
    if (!authLoading && session) navigate("/demo", { replace: true });
  }, [session, authLoading, navigate]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/demo`,
            data: { full_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast({ title: "Welcome!", description: "Account created. Redirecting…" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast({ title: "Signed in" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      toast({ title: "Auth error", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/demo` },
      });
      if (error) throw error;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Google sign-in failed";
      toast({ title: "Sign-in error", description: msg, variant: "destructive" });
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-lg bg-gradient-primary grid place-items-center shadow-md">
            <Hand className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display text-xl">OmniPoint</span>
        </div>

        <div className="border border-border bg-card shadow-2xl p-6 sm:p-8">
          <div className="grid grid-cols-2 gap-1 mb-6 border hairline">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`h-9 font-mono text-[11px] tracking-[0.25em] transition-colors ${
                  mode === m
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "signin" ? "SIGN IN" : "CREATE ACCOUNT"}
              </button>
            ))}
          </div>

          <button
            onClick={handleGoogle}
            disabled={busy}
            className="w-full h-11 mb-4 inline-flex items-center justify-center gap-2.5 border border-border bg-background hover:bg-secondary text-foreground font-medium text-sm disabled:opacity-50 transition-colors"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-border" />
            <span className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground">OR</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <form onSubmit={handleEmail} className="space-y-3">
            {mode === "signup" && (
              <Field
                icon={<UserIcon className="w-4 h-4" />}
                type="text"
                placeholder="Display name"
                value={name}
                onChange={setName}
                autoComplete="name"
              />
            )}
            <Field
              icon={<Mail className="w-4 h-4" />}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={setEmail}
              required
              autoComplete="email"
            />
            <Field
              icon={<Lock className="w-4 h-4" />}
              type="password"
              placeholder="Password (min 8 chars)"
              value={password}
              onChange={setPassword}
              required
              minLength={8}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-colors"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  {mode === "signin" ? "Sign in" : "Create account"}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            By continuing you agree to use the app responsibly.
          </p>
        </div>

        <div className="mt-6 text-center">
          <Link
            to="/demo"
            className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground hover:text-foreground"
          >
            CONTINUE WITHOUT ACCOUNT →
          </Link>
        </div>
      </div>
    </main>
  );
};

function Field({
  icon,
  type,
  placeholder,
  value,
  onChange,
  required,
  minLength,
  autoComplete,
}: {
  icon: React.ReactNode;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
}) {
  return (
    <label className="flex items-center gap-2 border border-border bg-background h-11 px-3 focus-within:border-primary transition-colors">
      <span className="text-muted-foreground">{icon}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground/60"
      />
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.7 4.7-6.2 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.6 16.1 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.1 0-9.5-3.3-11.2-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2c-.4.4 6.7-4.9 6.7-14.8 0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}

export default Auth;
