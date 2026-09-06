import { BookOpen, FileText } from "lucide-react";
import Link from "next/link";
import type { LibraryDocument } from "@/lib/types/document";
import { LinkPending } from "./link-pending";
import { DocumentActions } from "./document-actions";

const statusLabel = {
  uploading: "Uploading",
  queued: "Queued",
  processing: "Parsing",
  ready: "Ready",
  failed: "Needs attention",
  published: "Published",
  deleting: "Deleting",
};

export function LibraryCard({ document }: { document: LibraryDocument }) {
  const isReadable = !!document.active_version_id && (document.status === "ready" || document.status === "published");
  const href = isReadable ? `/documents/${document.document_ref}/read` : `/documents/${document.document_ref}/processing`;
  return (
    <article className="library-card">
      <div className="paper-thumbnail" aria-hidden="true"><span className="thumbnail-rule" /><span /><span /><span /><i>∑</i><span /><span /></div>
      <div className="library-card-body">
        <div className="card-meta"><span className={`status-pill status-${document.status}`}><i />{statusLabel[document.status]}</span><DocumentActions document={document} /></div>
        <h2><Link href={href}>{document.title}<LinkPending /></Link></h2>
        <p className="card-authors">{document.authors.slice(0, 3).join(", ") || "Research paper"}{document.authors.length > 3 ? " et al." : ""}</p>
        <div className="card-bottom"><span><FileText size={14} />{document.source_type.toUpperCase()}{document.page_count ? ` · ${document.page_count} pages` : ""}</span><Link className="card-open" href={href}>{isReadable ? <><BookOpen size={16} />Read</> : "View progress"}<LinkPending /></Link></div>
      </div>
    </article>
  );
}
