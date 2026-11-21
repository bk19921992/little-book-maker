import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, PencilLine } from 'lucide-react';
import hero from '@/assets/storybook-hero.jpg';
import { MAINTENANCE_CREDITS_PAUSED, MAINTENANCE_STATUS_SHORT } from '@/lib/pricing';
import './landing.css';

const samplePages = [
  ['1', 'Fern the fox found a silver lantern at the bottom of the garden. It glowed whenever someone told the truth kindly.'],
  ['2', '"We should find its owner," said Pip the wren. So they followed the moonlit footprints past the vegetable patch.'],
  ['3', 'At the old apple tree, a hedgehog was searching for his way home. Fern lifted the lantern, and the path lit up one step at a time.'],
  ['4', '"I was worried I would be lost all night," said the hedgehog. "You do not have to do it alone," Fern replied.'],
  ['5', 'They walked together until the hedgehog\'s little round door appeared beneath the rose bush. Inside, a warm light was waiting.'],
  ['6', 'The lantern belonged to no one and everyone. From that night on, it hung by the garden gate, ready to help the next traveller.'],
];

export default function Sample() {
  return (
    <div className="sprout-landing">
      <a className="sprout-skip" href="#main">Skip to content</a>
      <header className="sprout-header sprout-wrap">
        <Link className="sprout-brand" to="/" aria-label="Make, by The Children's Library - home"><img src="/favicon.svg" alt="" width="28" height="28" /><span translate="no">Make</span><span className="sprout-brand-parent">The Children's Library</span></Link>
        <nav aria-label="Main navigation"><Link className="sprout-nav-link" to="/">Home</Link><Link className="sprout-nav-link" to="/app">Sign in <ArrowRight aria-hidden="true" /></Link></nav>
      </header>
      <main id="main">
        <section className="sprout-sample-hero sprout-wrap" aria-labelledby="sample-title">
          <div>
            <p className="sprout-eyebrow"><BookOpen aria-hidden="true" /> Sample story</p>
            <h1 id="sample-title">Fern and the<br /><em>Moon Lantern.</em></h1>
            <p className="sprout-intro">A short sample showing the tone, pacing and page-by-page reading experience. The words below are a fixed example, not a customer story.</p>
            <div className="sprout-actions">
              {!MAINTENANCE_CREDITS_PAUSED && <Link className="sprout-button" to="/app?mode=sign-up">Create your first book <ArrowRight aria-hidden="true" /></Link>}
              <Link className={MAINTENANCE_CREDITS_PAUSED ? 'sprout-button' : 'sprout-secondary'} to="/"><ArrowLeft aria-hidden="true" /> Back to home</Link>
              {MAINTENANCE_CREDITS_PAUSED && <span className="sprout-note" role="status">{MAINTENANCE_STATUS_SHORT}</span>}
            </div>
          </div>
          <figure className="sprout-book-scene">
            <div className="sprout-art"><img src={hero} width="1429" height="804" fetchPriority="high" alt="Friendly illustrated dragons sitting on an open storybook" /></div>
            <figcaption><span>Illustrative artwork</span><span>Fixed sample</span></figcaption>
          </figure>
        </section>
        <section className="sprout-sample-pages sprout-wrap" aria-label="Sample story pages">
          {samplePages.map(([page, text]) => (
            <article key={page} className="sprout-sample-page">
              <span className="sprout-page-number">Page {page}</span>
              <p>{text}</p>
            </article>
          ))}
        </section>
        <section className="sprout-sample-edit sprout-wrap" aria-labelledby="sample-edit-title">
          <div><p className="sprout-eyebrow"><PencilLine aria-hidden="true" /> Your book is yours to shape</p><h2 id="sample-edit-title">Review every page before it becomes a keepsake.</h2></div>
          <p>Generated stories are a starting point. You can edit the words, review the illustrations and download the finished PDF when it feels right.</p>
        </section>
      </main>
      <footer className="sprout-footer sprout-wrap"><Link className="sprout-brand" to="/"><img src="/favicon.svg" alt="" width="28" height="28" /><span translate="no">Make</span><span className="sprout-brand-parent">The Children's Library</span></Link><p>Little books. Made for reading together.</p><Link to="/app">Open your books <ArrowRight aria-hidden="true" /></Link></footer>
    </div>
  );
}
