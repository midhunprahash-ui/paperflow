"use client";

import { ArrowDown, ArrowUp, BookOpen, Clock3 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { LibraryDocument } from "@/lib/types/document";
import { DocumentActions } from "./document-actions";
import { LinkPending } from "./link-pending";

export type LibrarySort = "recent" | "oldest" | "title" | "title-desc";
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function modifiedAt(value: string, now: number) {
  const seconds = (Date.parse(value) - now) / 1000;
  if (!Number.isFinite(seconds)) return "Unknown date";
  const magnitude = Math.abs(seconds);
  for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    if (magnitude >= size) return relative.format(Math.trunc(seconds / size), unit);
  }
  return "Just now";
}

export function LibraryList({ documents, sort, onSort }: { documents: LibraryDocument[]; sort: LibrarySort; onSort: (sort: LibrarySort) => void }) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [now] = useState(() => Date.now());
  const all = useRef<HTMLInputElement>(null);
  const selectedCount = documents.filter(doc => selected.has(doc.id)).length;
  const allSelected = documents.length > 0 && selectedCount === documents.length;
  useEffect(() => { if (all.current) all.current.indeterminate = selectedCount > 0 && !allSelected; }, [selectedCount, allSelected]);
  const titleSort = sort === "title" || sort === "title-desc";
  function toggle(id: number) { setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }

  return <div className="library-list">
    {selectedCount > 0 && <div className="library-selection"><span role="status">{selectedCount} selected</span><button type="button" onClick={() => setSelected(new Set())}>Clear selection</button></div>}
    <div className="library-table-scroll" role="region" aria-label="Paper list" tabIndex={0}>
      <table className="library-table">
        <caption className="sr-only">Your papers, owners, last modified dates, and actions</caption>
        <colgroup><col className="library-select-column" /><col /><col className="library-owner-column" /><col className="library-modified-column" /><col className="library-actions-column" /></colgroup>
        <thead><tr>
          <th scope="col" className="library-select-cell"><input ref={all} type="checkbox" aria-label="Select all shown papers" checked={allSelected} onChange={() => setSelected(previous => { const next = new Set(previous); for (const doc of documents) { if (allSelected) next.delete(doc.id); else next.add(doc.id); } return next; })} /></th>
          <th scope="col" aria-sort={titleSort ? sort === "title" ? "ascending" : "descending" : "none"}><button type="button" className="library-sort-heading" onClick={() => onSort(sort === "title" ? "title-desc" : "title")}>Title{titleSort && (sort === "title" ? <ArrowUp size={15} /> : <ArrowDown size={15} />)}</button></th>
          <th scope="col">Owner</th>
          <th scope="col" aria-sort={!titleSort ? sort === "recent" ? "descending" : "ascending" : "none"}><button type="button" className="library-sort-heading" onClick={() => onSort(sort === "recent" ? "oldest" : "recent")}>Last modified{!titleSort && (sort === "recent" ? <ArrowDown size={15} /> : <ArrowUp size={15} />)}</button></th>
          <th scope="col" className="library-actions-cell">Actions</th>
        </tr></thead>
        <tbody>{documents.map(doc => {
          const readable = !!doc.active_version_id && ["ready", "published"].includes(doc.status);
          const href = `/documents/${doc.document_ref}/${readable ? "read" : "processing"}`;
          return <tr key={doc.id} data-selected={selected.has(doc.id) || undefined}>
            <td className="library-select-cell"><input type="checkbox" aria-label={`Select ${doc.title}`} checked={selected.has(doc.id)} onChange={() => toggle(doc.id)} /></td>
            <td className="library-table-title"><Link href={href} prefetch={readable}>{doc.title}<LinkPending /></Link>{!readable && <span className={`library-row-status status-${doc.status}`}>{doc.status === "failed" ? "Needs attention" : doc.status === "processing" ? "Parsing" : doc.status === "queued" ? "Queued" : doc.status === "uploading" ? "Uploading" : "Deleting"}</span>}</td>
            <td className="library-table-owner">You</td>
            <td className="library-table-modified"><time dateTime={doc.updated_at} title={doc.updated_at} suppressHydrationWarning>{modifiedAt(doc.updated_at, now)}</time></td>
            <td className="library-actions-cell"><div className="library-row-actions"><Link className="row-action" href={href} prefetch={readable} aria-label={`${readable ? "Read" : "View progress for"} ${doc.title}`} title={readable ? "Read paper" : "View progress"}>{readable ? <BookOpen size={17} /> : <Clock3 size={17} />}</Link><DocumentActions document={doc} layout="row" /></div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </div>;
}
