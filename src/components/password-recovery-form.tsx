"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function PasswordRecoveryForm({ reset = false }: { reset?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const supabase = createClient();
    if (!supabase) { router.push("/auth/sign-in"); return; }
    if (reset) {
      const password = String(data.get("password") ?? "");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) setMessage(error.message); else { router.push("/library"); router.refresh(); }
      return;
    }
    const email = String(data.get("email") ?? "");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password` });
    setMessage(error?.message ?? "Check your inbox for a secure password reset link.");
  }
  return <form className="auth-form" onSubmit={submit}><label><span>{reset ? "New password" : "Email address"}</span><input name={reset ? "password" : "email"} type={reset ? "password" : "email"} minLength={reset ? 8 : undefined} required /></label>{message && <p className="form-message" role="status">{message}</p>}<button className="button button-primary button-full" type="submit">{reset ? "Save new password" : "Send reset link"}</button></form>;
}
