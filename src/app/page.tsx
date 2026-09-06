import Link from "next/link";
import { ArrowRight, BookOpen, FileText, MoonStar, ScanText, Table2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

export default function HomePage() {
  return (
    <main>
      <SiteHeader />
      <section className="hero container">
        <div className="hero-copy">
          <span className="eyebrow">A better home for research</span>
          <h1>Papers were made to be <em>understood.</em></h1>
          <p>Upload a PDF and Rpaper prepares a calm, responsive reading copy. Your original stays available for equations, tables, figures, and footnotes.</p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/auth/sign-up">Build your library <ArrowRight size={18} /></Link>
            <Link className="button button-secondary" href="/sample"><BookOpen size={18} /> See a sample</Link>
          </div>
          <p className="hero-note">Private library · Original file preserved · Comfortable reading</p>
        </div>
        <div className="hero-visual" aria-label="Research paper transformed into a readable page">
          <div className="source-paper">
            <div className="paper-label"><FileText size={14} /> source-paper.pdf</div>
            <div className="tiny-title" />
            <div className="tiny-columns"><div /><div /></div>
          </div>
          <div className="transform-line"><span /><span /><span /></div>
          <div className="reader-preview">
            <div className="reader-preview-top"><span /><span /></div>
            <div className="reader-preview-kicker">Introduction</div>
            <div className="reader-preview-title">Attention is all you need</div>
            <div className="reader-preview-lines"><span /><span /><span /><span /></div>
            <div className="reader-preview-formula">Attention(Q, K, V)</div>
          </div>
        </div>
      </section>
      <section className="feature-strip container" aria-label="Features">
        <article><ScanText /><h2>A reading copy</h2><p>Extracted text organized by page, with references.</p></article>
        <article><Table2 /><h2>Original preserved</h2><p>Open the source PDF for equations, tables, and figures.</p></article>
        <article><MoonStar /><h2>Made for reading</h2><p>Elegant typography across light and dark modes.</p></article>
      </section>
    </main>
  );
}
