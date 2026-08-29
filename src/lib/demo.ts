import type { LibraryDocument, PaperDocument, ProcessingJob } from "@/lib/types/document";

export const demoLibrary: LibraryDocument[] = [
  {
    id: 1,
    document_ref: "doc_000000000001",
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
    source_type: "pdf",
    status: "ready",
    page_count: 15,
    updated_at: "2026-08-28T10:30:00.000Z",
  },
  {
    id: 2,
    document_ref: "doc_000000000002",
    title: "Language Models are Few-Shot Learners",
    authors: ["Tom B. Brown", "Benjamin Mann", "Nick Ryder"],
    source_type: "pdf",
    status: "processing",
    page_count: 75,
    updated_at: "2026-08-29T07:45:00.000Z",
  },
];

export const demoJob: ProcessingJob = {
  id: 2,
  job_ref: "job_000000000002",
  document_id: 2,
  status: "processing",
  stage: "layout",
  progress: 36,
  error_code: null,
  error_message: null,
  updated_at: new Date().toISOString(),
};

export const demoPaper: PaperDocument = {
  schemaVersion: 1,
  metadata: {
    title: "Attention Is All You Need",
    authors: [
      "Ashish Vaswani",
      "Noam Shazeer",
      "Niki Parmar",
      "Jakob Uszkoreit",
      "Llion Jones",
      "Aidan N. Gomez",
      "Łukasz Kaiser",
      "Illia Polosukhin",
    ],
    abstract:
      "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We introduce a simpler architecture based solely on attention mechanisms.",
    publishedAt: "2017",
    pageCount: 15,
  },
  source: { type: "pdf", filename: "attention-is-all-you-need.pdf" },
  sections: [
    { id: "introduction", type: "heading", level: 1, text: "1. Introduction", order: 1, page: 1 },
    {
      id: "intro-p1",
      type: "paragraph",
      text: "Recurrent neural networks have been firmly established as state-of-the-art approaches in sequence modeling and transduction problems such as language modeling and machine translation.",
      order: 2,
      page: 1,
    },
    {
      id: "intro-p2",
      type: "paragraph",
      text: "The Transformer follows an encoder-decoder structure. Instead of recurrence, the model relies entirely on attention to draw global dependencies between input and output.",
      order: 3,
      page: 2,
    },
    { id: "architecture", type: "heading", level: 1, text: "2. Model Architecture", order: 4, page: 2 },
    {
      id: "architecture-p1",
      type: "paragraph",
      text: "Most competitive neural sequence transduction models have an encoder-decoder structure. The encoder maps an input sequence to a continuous representation, and the decoder generates an output sequence one element at a time.",
      order: 5,
      page: 2,
    },
    {
      id: "attention-formula",
      type: "formula",
      latex: "\\operatorname{Attention}(Q,K,V)=\\operatorname{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V",
      label: "Equation 1",
      order: 6,
      page: 3,
    },
    { id: "results", type: "heading", level: 1, text: "3. Results", order: 7, page: 7 },
    {
      id: "results-table",
      type: "table",
      caption: "Table 1. Translation quality and training cost.",
      headers: ["Model", "BLEU", "Training cost"],
      rows: [
        ["GNMT + RL", "24.6", "2.3 × 10¹⁹"],
        ["ConvS2S", "25.2", "9.6 × 10¹⁸"],
        ["Transformer (base)", "27.3", "3.3 × 10¹⁸"],
        ["Transformer (big)", "28.4", "2.3 × 10¹⁹"],
      ],
      order: 8,
      page: 8,
    },
    {
      id: "conclusion",
      type: "heading",
      level: 1,
      text: "4. Conclusion",
      order: 9,
      page: 10,
    },
    {
      id: "conclusion-p1",
      type: "paragraph",
      text: "We presented the Transformer, the first sequence transduction model based entirely on attention. The architecture can be trained significantly faster than recurrent or convolutional alternatives.",
      order: 10,
      page: 10,
    },
  ],
  references: [
    "Bahdanau, D., Cho, K., and Bengio, Y. Neural machine translation by jointly learning to align and translate.",
    "Gehring, J. et al. Convolutional sequence to sequence learning.",
  ],
};
