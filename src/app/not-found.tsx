import Link from "next/link";
import { BookX } from "lucide-react";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return <main className="not-found"><Brand /><BookX size={42} strokeWidth={1.4} /><h1>This page is missing.</h1><p>The paper may be private, unpublished, or no longer available.</p><Link className="button button-primary" href="/library">Return to library</Link></main>;
}
