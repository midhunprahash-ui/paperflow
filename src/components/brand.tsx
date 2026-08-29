import Link from "next/link";
import { BookOpenText } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="Rpaper home">
      <span className="brand-mark" aria-hidden="true"><BookOpenText size={19} strokeWidth={1.8} /></span>
      {!compact && <span>Rpaper</span>}
    </Link>
  );
}
