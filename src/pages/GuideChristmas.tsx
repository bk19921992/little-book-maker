import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, PencilLine, Download, ExternalLink } from 'lucide-react';
import { track } from '@vercel/analytics/react';
import { PRICES, ADDITIONAL_BOOK_POLICY, PAID_CHECKOUT_ENABLED, PAID_CHECKOUT_NOTICE, MAINTENANCE_CREDITS_PAUSED, MAINTENANCE_STATUS_SHORT } from '@/lib/pricing';
import './landing.css';

const GUIDE_TITLE = 'A personalised Christmas book for children | Make, by The Children\'s Library';
const GUIDE_DESCRIPTION = 'Make a personalised Christmas story for your child: their name, favourite toy and a Christmas adventure you choose. Review every page, then download the PDF. Your first book is free.';

const libraryGuides = [
  ['Christmas books for children: the full guide', 'https://thechildrenslibrary.uk/guides/christmas-books-for-children.html'],
  ['Christmas books for 3 year olds', 'https://thechildrenslibrary.uk/guides/christmas-books-for-3-year-olds.html'],
  ['Christmas books for 5 year olds', 'https://thechildrenslibrary.uk/guides/christmas-books-for-5-year-olds.html'],
  ['Christmas books for 7 to 10 year olds', 'https://thechildrenslibrary.uk/guides/christmas-books-for-7-to-10-year-olds.html'],
];

export default function GuideChristmas() {
  useEffect(() => {
    document.title = GUIDE_TITLE;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', GUIDE_DESCRIPTION);
  }, []);

  return (
    <div className="sprout-landing">
      <a className="sprout-skip" href="#main">Skip to content</a>
      <header className="sprout-header sprout-wrap">
        <Link className="sprout-brand" to="/" aria-label="Make, by The Children's Library - home"><img src="/favicon.svg" alt="" width="28" height="28" /><span translate="no">Make</span><span className="sprout-brand-parent">The Children's Library</span></Link>
        <nav aria-label="Main navigation"><Link className="sprout-nav-link" to="/sample">See a sample</Link><Link className="sprout-nav-link" to="/app?mode=sign-in">Sign in <ArrowRight aria-hidden="true" /></Link></nav>
      </header>
      <main id="main">
        <section className="sprout-process sprout-wrap" aria-labelledby="guide-title">
          <div>
            <p className="sprout-eyebrow"><BookOpen aria-hidden="true" /> A Christmas story with their name in it</p>
            <h1 id="guide-title">A personalised Christmas book, made from their ideas.</h1>
            <p className="sprout-intro">Make writes and illustrates a Christmas story around your child: their name, their favourite toy, and the adventure you choose together. A moonlit trip with Father Christmas, a lost reindeer, the North Pole postal service. You review every page before anyone reads it.</p>
          </div>
          <ol className="sprout-steps">
            <li><span className="sprout-step-number">01</span><div><h2>Tell us about them</h2><p>Pick the child's name, a favourite toy or pet, and the Christmas setting. No blank page: a few choices and the story begins.</p></div><BookOpen aria-hidden="true" /></li>
            <li><span className="sprout-step-number">02</span><div><h2>Review and edit every page</h2><p>Read the story and check the illustrations. Edit the words until it sounds like something your family would actually say.</p></div><PencilLine aria-hidden="true" /></li>
            <li><span className="sprout-step-number">03</span><div><h2>Read it together on Christmas Eve</h2><p>Download your finished book as a PDF to read aloud or print at home. Your first book and PDF are free.</p></div><Download aria-hidden="true" /></li>
          </ol>
        </section>
        <section className="sprout-hero sprout-wrap" aria-label="Start your Christmas book">
          <div className="sprout-hero-copy">
            {MAINTENANCE_CREDITS_PAUSED ? (
              <div className="sprout-actions"><Link className="sprout-button" to="/sample">See a sample story <ArrowRight aria-hidden="true" /></Link><span className="sprout-note" role="status">{MAINTENANCE_STATUS_SHORT}</span></div>
            ) : (
              <>
                <div className="sprout-actions"><Link className="sprout-button" to="/app" onClick={() => track('christmas-guide-cta')}>Create your Christmas book <ArrowRight aria-hidden="true" /></Link><Link className="sprout-secondary" to="/sample">See a sample story</Link></div>
                <p className="sprout-note">Your first book and PDF are free. {ADDITIONAL_BOOK_POLICY} {!PAID_CHECKOUT_ENABLED && PAID_CHECKOUT_NOTICE} Printed books are in preparation.</p>
              </>
            )}
          </div>
        </section>
        <section className="sprout-audience sprout-wrap" aria-labelledby="ready-made-title">
          <div>
            <p className="sprout-eyebrow">Prefer a book that already exists?</p>
            <h2 id="ready-made-title">Christmas picks from<br />The Children's Library.</h2>
            <p>Our bookshop guides list the Christmas books we rate for each age, with notes on what to expect and where to buy them.</p>
          </div>
          <ul>
            {libraryGuides.map(([label, url]) => (
              <li key={url}><h3><a href={url} target="_blank" rel="noopener">{label} <ExternalLink aria-hidden="true" size={16} /></a></h3></li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="sprout-footer sprout-wrap"><Link className="sprout-brand" to="/"><img src="/favicon.svg" alt="" width="28" height="28" /><span translate="no">Make</span><span className="sprout-brand-parent">The Children's Library</span></Link><p>Little books. Made for reading together.</p><a href="https://thechildrenslibrary.uk/guides/christmas-books-for-children.html" target="_blank" rel="noopener">Christmas book ideas at The Children's Library</a><Link to="/app">Open your books <ArrowRight aria-hidden="true" /></Link></footer>
    </div>
  );
}
