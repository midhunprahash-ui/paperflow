import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { Brand } from "@/components/brand";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return <AuthPageShell><Suspense><AuthForm mode="sign-in" /></Suspense></AuthPageShell>;
}

function AuthPageShell({ children }: { children: React.ReactNode }) {
  return <main className="auth-page"><div className="auth-top"><Brand /></div>{children}<p className="auth-legal">By continuing, you agree to use uploaded papers responsibly.</p></main>;
}
