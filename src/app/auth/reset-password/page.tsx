import { Brand } from "@/components/brand";
import { PasswordRecoveryForm } from "@/components/password-recovery-form";

export const metadata = { title: "Choose a new password" };
export default function ResetPasswordPage() {
  return <main className="auth-page"><div className="auth-top"><Brand /></div><section className="auth-card"><div className="auth-heading"><span className="eyebrow">Account recovery</span><h1>Choose a new password</h1><p>Use at least eight characters.</p></div><PasswordRecoveryForm reset /></section></main>;
}
