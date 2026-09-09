"use client";

import { useDeferredValue, useRef, useState } from "react";
import { BookOpen, Check, Clock3, LayoutGrid, List, Search, X } from "lucide-react";
import { LibraryCard } from "./library-card";
import { LibraryList, type LibrarySort } from "./library-list";
import type { LibraryDocument } from "@/lib/types/document";

type Filter = "all" | "ready" | "processing";
const readable = (doc: LibraryDocument) => !!doc.active_version_id && ["ready", "published"].includes(doc.status);
export function LibraryExplorer({ documents, initialQuery = "" }: { documents: LibraryDocument[]; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const search = useDeferredValue(query.trim().toLowerCase());
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const input = useRef<HTMLInputElement>(null);
  const ready = documents.filter(readable).length;
  const filtered = documents.filter(doc => (filter === "all" || (filter === "ready" ? readable(doc) : !readable(doc))) && `${doc.title} ${doc.authors.join(" ")}`.toLowerCase().includes(search));
  filtered.sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : sort === "title-desc" ? b.title.localeCompare(a.title) : sort === "oldest" ? Date.parse(a.updated_at) - Date.parse(b.updated_at) : Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return <section className="collection" aria-label="Your research papers">
    <div className="collection-toolbar">
      <label className="collection-search"><Search size={18} aria-hidden="true" /><input ref={input} type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search your library" placeholder="Search by title or author…" />{query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); input.current?.focus(); }}><X size={16} /></button>}</label>
      <div className="collection-view" aria-label="Paper layout"><button aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={18} /></button><button aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={17} /></button></div>
    </div>
    <div className="collection-options"><div className="collection-filters" aria-label="Filter papers">{([{ id: "all", label: "All papers", count: documents.length }, { id: "ready", label: "Ready to read", count: ready }, { id: "processing", label: "Not ready", count: documents.length - ready }] as const).map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.id === "ready" && <Check size={14} />}{item.id === "processing" && <Clock3 size={14} />}{item.label}<span>{item.count}</span></button>)}</div><label className="collection-sort"><span className="sr-only">Sort papers</span><select value={sort} onChange={e => setSort(e.target.value as LibrarySort)}><option value="recent">Recently updated</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option><option value="title-desc">Title Z–A</option></select></label></div>
    <p className="sr-only" role="status">{filtered.length} {filtered.length === 1 ? "paper" : "papers"} shown</p>
    {filtered.length ? <div aria-busy={query.trim().toLowerCase() !== search}>{view === "list" ? <LibraryList documents={filtered} sort={sort} onSort={setSort} /> : <div className="paper-collection paper-collection-grid">{filtered.map(doc => <LibraryCard key={doc.id} document={doc} />)}</div>}</div> : <div className="collection-empty"><span className="empty-book"><BookOpen size={26} /></span><h2>{documents.length ? "No papers found" : "Your next idea starts here"}</h2><p>{documents.length ? "Try another title, author, or filter." : "Upload a research paper to make room for focused reading. Its structure and original PDF stay with you."}</p>{documents.length > 0 && <button className="button button-secondary button-small" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button>}</div>}
    <div className="collection-footer"><span>{documents.length} {documents.length === 1 ? "paper" : "papers"} in your collection</span><span>PDF · Up to 16 pages each</span></div>
  </section>;
}
