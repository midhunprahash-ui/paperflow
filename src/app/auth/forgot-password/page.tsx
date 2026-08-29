import Link from "next/link";
import { Brand } from "@/components/brand";
import { PasswordRecoveryForm } from "@/components/password-recovery-form";

export const metadata = { title: "Reset password" };
export default function ForgotPasswordPage() {
  return <main className="auth-page"><div className="auth-top"><Brand /></div><section className="auth-card"><div className="auth-heading"><span className="eyebrow">Account recovery</span><h1>Reset your password</h1><p>We’ll email you a secure link.</p></div><PasswordRecoveryForm /><p className="auth-switch"><Link href="/auth/sign-in">Return to sign in</Link></p></section></main>;
}
