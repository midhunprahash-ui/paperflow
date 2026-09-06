"use client";
import { useLinkStatus } from "next/link";
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span className={`link-pending${pending ? " is-pending" : ""}`} aria-hidden="true" />;
}
