"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Send, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/client";

type Sender = { name: string; email: string };
export default function FeedbackForm({ onSent }: { onSent: () => void }) {
  const [sender, setSender] = useState<Sender | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const submission = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => {
    const client = createClient();
    if (!client) return;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      const metadata = user?.user_metadata;
      setSender(user ? { name: metadata?.full_name || metadata?.name || user.email?.split("@")[0] || "", email: user.email || "" } : null);
      submission.current = null;
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const payload = JSON.stringify({ name: sender?.name ?? String(fields.get("name") ?? "").trim(), email: sender?.email ?? String(fields.get("email") ?? "").trim(), feedback: String(fields.get("feedback") ?? "").trim() });
    if (submission.current?.payload !== payload) submission.current = { payload, id: crypto.randomUUID() };
    setSending(true); setError("");
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...JSON.parse(payload), id: submission.current.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn’t send feedback. Please try again.");
      form.reset(); submission.current = null;
      toast.success("Feedback sent", { description: "Thank you for helping improve paperflow." });
      onSent();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn’t send feedback. Please try again.";
      setError(message); toast.error(message);
    } finally { setSending(false); }
  }
  return <form className="feedback-form" onSubmit={send}>
    {loading ? <p role="status">Loading your details…</p> : sender ? <p className="feedback-sender">Sending as <strong>{sender.name}</strong><span>{sender.email}</span></p> : <div className="feedback-identity">
      <label>Your name<input name="name" autoComplete="name" maxLength={160} required /></label>
      <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
    </div>}
    <label className="feedback-message">Your feedback<textarea name="feedback" placeholder="What’s working? What could be better?" rows={4} minLength={5} maxLength={4000} required disabled={sending} /></label>
    {error && <p className="feedback-error" role="alert">{error}</p>}
    <button className="button button-primary" type="submit" disabled={sending || loading}>{sending ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}{sending ? "Sending…" : "Send feedback"}</button>
  </form>;
}
