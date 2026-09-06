import Link from "next/link";
import type { MouseEventHandler } from "react";

export function Brand({ compact = false, href = "/", onClick }: { compact?: boolean; href?: string; onClick?: MouseEventHandler<HTMLAnchorElement> }) {
  return (
    <Link className="brand" href={href} onClick={onClick} aria-label={href === "/library" ? "paperflow library" : "paperflow home"}>
      <span className="brand-slash" aria-hidden="true">/</span>
      {!compact && <span className="brand-name">paperflow</span>}
    </Link>
  );
}
