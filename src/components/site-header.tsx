import Link from "next/link";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Brand />
        <nav className="header-actions" aria-label="Primary navigation">
          <ThemeToggle />
          {signedIn ? (
            <Link className="button button-secondary button-small" href="/library">My library</Link>
          ) : (
            <>
              <Link className="text-link hide-mobile" href="/auth/sign-in">Sign in</Link>
              <Link className="button button-primary button-small" href="/auth/sign-up">Get started</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
