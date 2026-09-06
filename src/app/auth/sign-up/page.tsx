import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { Brand } from "@/components/brand";

export const metadata = { title: "Create account" };

export default function SignUpPage() {
  return <main className="auth-page"><div className="auth-top"><Brand /></div><Suspense><AuthForm mode="sign-up" /></Suspense><p className="auth-legal">By continuing, you agree to use uploaded papers responsibly.</p></main>;
}
