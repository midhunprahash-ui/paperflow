export type Bounds = [number, number, number, number];

export type PaperMetadata = {
  title: string;
  authors: string[];
  abstract?: string;
  publishedAt?: string;
  doi?: string;
  pageCount?: number;
};

type BaseNode = {
  id: string;
  order: number;
  page?: number;
  bounds?: Bounds;
  confidence?: number;
  sourceAsset?: string;
  sourceId?: string;
  role?: string;
  sectionId?: string | null;
  sectionPath?: string[];
  inline?: InlinePart[];
  sourceFragments?: { asset: string; page: number; widthEm?: number }[];
  provenance?: unknown[];
};

export type InlinePart = { type: "text"; text: string; bold?: boolean; italic?: boolean; script?: "sub" | "sup" | null }
  | { type: "image"; asset: string; alt: string; widthEm?: number | null; descentEm?: number; candidateLatex?: string };
export type PaperAsset = { path: string; sha256: string; mediaType: string; url?: string };

export type HeadingNode = BaseNode & {
  type: "heading";
  level: number;
  text: string;
  explicitHierarchy?: boolean;
};

export type ParagraphNode = BaseNode & {
  type: "paragraph";
  text: string;
};

export type ListNode = BaseNode & {
  type: "list";
  ordered: boolean;
  items: string[];
};

export type FormulaNode = BaseNode & {
  type: "formula";
  latex: string;
  label?: string;
  candidateLatex?: string;
  verified?: boolean;
};

export type TableNode = BaseNode & {
  type: "table";
  caption?: string;
  headers: string[];
  rows: string[][];
  rowCount?: number;
  colCount?: number;
  cells?: { row: number; col: number; rowSpan: number; colSpan: number; header: boolean; text: string; sourceAsset?: string; inline?: InlinePart[] }[];
};

export type FigureNode = BaseNode & {
  type: "figure";
  caption?: string;
  alt: string;
  assetUrl: string;
};

export type CodeNode = BaseNode & {
  type: "code";
  language?: string;
  code: string;
};

export type FootnoteNode = BaseNode & {
  type: "footnote";
  label: string;
  text: string;
};

export type DocumentNode =
  | HeadingNode
  | ParagraphNode
  | ListNode
  | FormulaNode
  | TableNode
  | FigureNode
  | CodeNode
  | FootnoteNode
  | (BaseNode & { type: "list_item"; text: string; marker: string; listId: string })
  | (BaseNode & { type: "caption"; text: string; captionOf: string });

export type PaperDocument = {
  schemaVersion: 1 | 2;
  metadata: PaperMetadata;
  sections: DocumentNode[];
  references: string[];
  assets?: Record<string, PaperAsset>;
  hierarchy?: { id: string; title: string; level: number; parent: string | null; children: string[]; blocks: string[] }[];
  parser?: { name: string; version: string; reviewRequired: boolean; limits: string };
  source: {
    type: "pdf" | "docx";
    filename: string;
    checksum?: string;
  };
};

export type DocumentStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "published"
  | "deleting";

export type ProcessingStage =
  | "queued"
  | "validating"
  | "layout"
  | "ocr"
  | "tables_formulas"
  | "assets"
  | "assembling"
  | "quality_check"
  | "ready"
  | "failed";

export type LibraryDocument = {
  id: number;
  document_ref: string;
  title: string;
  authors: string[];
  source_type: "pdf" | "docx";
  status: DocumentStatus;
  page_count: number | null;
  updated_at: string;
  active_version_id?: number | null;
  public_slug?: string | null;
};

export type ProcessingJob = {
  id: number;
  job_ref: string;
  document_id: number;
  status: "queued" | "processing" | "ready" | "failed";
  stage: ProcessingStage;
  progress: number;
  error_code: string | null;
  error_message: string | null;
  updated_at: string;
};
