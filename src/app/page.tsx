import Link from "next/link";
import { ArrowRight, BookOpen, MoonStar, ScanText, Table2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

export default function HomePage() {
  return (
    <main>
      <SiteHeader />
      <section className="hero container">
        <div className="hero-copy">
          <span className="eyebrow">A better home for research</span>
          <h1>Papers were made to be <em>understood.</em></h1>
          <p>Bring your research into a focused reading space. Navigate the paper’s sections, keep its technical details close, and return to the original whenever you need.</p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/auth/sign-up">Build your library <ArrowRight size={18} /></Link>
            <Link className="button button-secondary" href="/sample"><BookOpen size={18} /> See a sample</Link>
          </div>
          <p className="hero-note">Private library · Original file preserved · Comfortable reading</p>
        </div>
        <div className="product-preview" aria-label="Preview of a paper with its section navigation">
          <div className="preview-toolbar"><i /><i /><i /><span>Your reading space</span></div>
          <div className="preview-workspace"><aside><strong>Contents</strong><b>01 Introduction</b><span>02 Background</span><span>03 Model architecture</span><span>04 Results</span><span>05 References</span></aside><article><span>Research paper · 15 pages</span><h2>Attention is<br />all you need</h2><p>Vaswani et al. · Neural Information Processing Systems</p><h3>1. Introduction</h3><p>The original ideas. The same structure. A little more room to understand them.</p><div className="reader-preview-lines"><span /><span /><span /><span /></div><div className="preview-formula">Attention(Q, K, V)</div></article></div>
        </div>
      </section>
      <section className="feature-strip container" aria-label="Features">
        <article><ScanText /><h2>Follow the argument</h2><p>Move through the paper’s sections and subsections without losing your place.</p></article>
        <article><Table2 /><h2>Keep the details</h2><p>Tables, figures, and source-backed math stay part of the reading experience.</p></article>
        <article><MoonStar /><h2>Made for reading</h2><p>Elegant typography across light and dark modes.</p></article>
      </section>
    </main>
  );
}
