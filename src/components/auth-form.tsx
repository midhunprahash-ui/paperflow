"use client";

import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type Mode = "sign-in" | "sign-up";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState<"google" | "email" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isSignIn = mode === "sign-in";

  async function signInWithGoogle() {
    const supabase = createClient();
    if (!supabase) {
      router.push("/library");
      return;
    }
    setLoading("google");
    const redirectTo = `${window.location.origin}/auth/callback?next=/library`;
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) {
      setMessage(error.message);
      setLoading(null);
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const supabase = createClient();

    if (!supabase) {
      router.push("/library");
      return;
    }

    setLoading("email");
    setMessage(null);
    if (isSignIn) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(error.message);
        setLoading(null);
        return;
      }
      router.push(searchParams.get("next") || "/library");
      router.refresh();
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/library` },
    });
    setLoading(null);
    setMessage(error ? error.message : "Check your email to verify your account, then return to sign in.");
  }

  return (
    <div className="auth-card">
      <div className="auth-heading">
        <span className="eyebrow">Your research, reflowed</span>
        <h1>{isSignIn ? "Welcome back" : "Create your library"}</h1>
        <p>{isSignIn ? "Continue reading where you left off." : "Turn dense papers into calm, readable pages."}</p>
      </div>

      {!isSupabaseConfigured && <div className="demo-notice">Demo mode is active. Any valid form submission opens the sample library.</div>}

      <button className="button button-google" type="button" onClick={signInWithGoogle} disabled={loading !== null}>
        {loading === "google" ? <LoaderCircle className="spin" size={18} /> : <GoogleMark />}
        Continue with Google
      </button>

      <div className="divider"><span>or continue with email</span></div>

      <form className="auth-form" onSubmit={submitEmail}>
        <label>
          <span>Email address</span>
          <input name="email" type="email" autoComplete="email" placeholder="you@university.edu" required />
        </label>
        <label>
          <span>Password</span>
          <span className="password-field">
            <input name="password" type={showPassword ? "text" : "password"} minLength={8} autoComplete={isSignIn ? "current-password" : "new-password"} placeholder="At least 8 characters" required />
            <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
        {isSignIn && <Link className="forgot-link" href="/auth/forgot-password">Forgot password?</Link>}
        {message && <p className="form-message" role="status">{message}</p>}
        <button className="button button-primary button-full" type="submit" disabled={loading !== null}>
          {loading === "email" ? <LoaderCircle className="spin" size={18} /> : <>{isSignIn ? "Sign in" : "Create account"}<ArrowRight size={17} /></>}
        </button>
      </form>
      <p className="auth-switch">
        {isSignIn ? "New to paperflow?" : "Already have an account?"}{" "}
        <Link href={isSignIn ? "/auth/sign-up" : "/auth/sign-in"}>{isSignIn ? "Create an account" : "Sign in"}</Link>
      </p>
    </div>
  );
}

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="currentColor" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.715v2.259h2.909c1.702-1.567 2.684-3.875 2.684-6.614Z"/><path fill="currentColor" opacity=".76" d="M9 18c2.43 0 4.467-.806 5.956-2.181l-2.909-2.259c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z"/><path fill="currentColor" opacity=".55" d="M3.963 10.706A5.42 5.42 0 0 1 3.682 9c0-.592.102-1.168.281-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.038l3.007-2.332Z"/><path fill="currentColor" opacity=".9" d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.582-2.582C13.463.892 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z"/></svg>;
}
