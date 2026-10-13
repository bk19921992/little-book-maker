import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Sprout, PencilLine, Download, ChevronDown } from 'lucide-react';
import { PRICES, ADDITIONAL_BOOK_POLICY, PAID_CHECKOUT_ENABLED, PAID_CHECKOUT_NOTICE } from '@/lib/pricing';
import hero from '@/assets/storybook-hero.jpg';
import './landing.css';

const questions = [
  ['What can I personalise?', 'Choose your characters, the setting, the kind of story and the illustration style. You can review the story and edit its pages before downloading.'],
  ['How do I get my book?', 'Download your finished book as a PDF to read together or print at home. Your books are saved to your account.'],
  ['Is there a free book?', 'Your first PDF download is free. Re-download that same book without paying again. Additional books will be £2.99 each when paid checkout opens.'],
  ['Can I order a printed book?', 'Not yet. Printed book ordering is still in preparation. For now, you can download a PDF.'],
  ['How are the stories made?', 'Story Sprout uses AI to write and illustrate your story from your choices. Always review the words and pictures before sharing them with a child.'],
];

export default function Landing() {
  return (
    <div className="sprout-landing">
      <a className="sprout-skip" href="#main">Skip to content</a>
      <header className="sprout-header sprout-wrap">
        <Link className="sprout-brand" to="/" aria-label="Story Sprout home"><Sprout aria-hidden="true" /><span translate="no">Story Sprout</span></Link>
        <nav aria-label="Main navigation"><a className="sprout-nav-link" href="#how-it-works">How it works</a><Link className="sprout-nav-link" to="/app">Sign in <ArrowRight aria-hidden="true" /></Link></nav>
      </header>
      <main id="main">
        <section className="sprout-hero sprout-wrap" aria-labelledby="hero-title">
          <div className="sprout-hero-copy">
            <p className="sprout-eyebrow"><BookOpen aria-hidden="true" /> A little story. A world of their own.</p>
            <h1 id="hero-title">Their imagination.<br />Your next<br /><em>bedtime story.</em></h1>
            <p className="sprout-intro">Create an AI-written, illustrated book from their favourite characters and big ideas. Edit the pages, then read it together.</p>
            <Link className="sprout-button" to="/app?mode=sign-up">Create your first book <ArrowRight aria-hidden="true" /></Link>
            <p className="sprout-note">Create an account. Your first generation and PDF are free; paid downloads and printed orders are not available yet.</p>
          </div>
          <figure className="sprout-book-scene">
            <div className="sprout-art"><img src={hero} width="1429" height="804" fetchPriority="high" alt="Two friendly illustrated dragons sitting on the pages of an open storybook" /></div>
            <figcaption><span>Small ideas grow into stories.</span><span>Illustrative artwork</span></figcaption>
          </figure>
        </section>
        <div className="sprout-promise"><div className="sprout-wrap"><span>Made from your ideas</span><span>Words you can edit</span><span>A PDF to keep</span></div></div>
        <section className="sprout-process sprout-wrap" id="how-it-works" aria-labelledby="process-title">
          <div><p className="sprout-eyebrow">From "what if" to "one more page"</p><h2 id="process-title">You bring the spark.<br />The story grows from there.</h2><p>No blank page to start with. Just a few choices about the world you want to make.</p></div>
          <ol className="sprout-steps">
            <li><span className="sprout-step-number">01</span><div><h3>Make it theirs</h3><p>Pick the characters, the setting and the picture style. A moon adventure? A gentle woodland tale? Start with what they love.</p></div><Sprout aria-hidden="true" /></li>
            <li><span className="sprout-step-number">02</span><div><h3>Give it your finishing touch</h3><p>Review the words and illustrations. Edit the pages until the story feels right for your family.</p></div><PencilLine aria-hidden="true" /></li>
            <li><span className="sprout-step-number">03</span><div><h3>Read it together</h3><p>Download your book as a PDF. Keep it for another bedtime or print it at home.</p></div><Download aria-hidden="true" /></li>
          </ol>
        </section>
        <section className="sprout-audience sprout-wrap" aria-labelledby="audience-title"><div><p className="sprout-eyebrow">For grown-ups with a story to share</p><h2 id="audience-title">Their interests.<br />Your time together.</h2></div><ul><li><h3>Parents and carers</h3><p>Make a bedtime story around the characters and places your child keeps talking about.</p></li><li><h3>Grandparents and family</h3><p>Bring a little of your own imagination to the next story you read together.</p></li><li><h3>A book to keep</h3><p>Save a PDF for family reading. You review every page before it becomes part of their bookshelf.</p></li></ul></section>
        <section className="sprout-pricing sprout-wrap" id="pricing" aria-labelledby="pricing-title"><div><p className="sprout-eyebrow">Simple prices. No subscription needed.</p><h2 id="pricing-title">Start with one<br />free story.</h2></div><div className="sprout-price-grid"><article><span className="sprout-eyebrow">Your first book</span><p className="sprout-price">Free</p><h3>Your first PDF download</h3><p>Create, review and download your first book. Keep re-downloading that same PDF for free.</p><Link className="sprout-button" to="/app?mode=sign-up">Create your free book <ArrowRight aria-hidden="true" /></Link></article><article><span className="sprout-eyebrow">Coming soon</span><p className="sprout-price">{new Intl.NumberFormat('en-GB', {style:'currency',currency:'GBP'}).format(PRICES.exportSingle / 100)}</p><h3>Each additional book</h3><p>{ADDITIONAL_BOOK_POLICY} {!PAID_CHECKOUT_ENABLED && PAID_CHECKOUT_NOTICE}</p></article><article><span className="sprout-eyebrow">Coming soon</span><p className="sprout-price">Print</p><h3>A paperback to your door</h3><p>Printing and delivery will be a separate cost. The delivered price is still being confirmed. No orders or payments are taken yet.</p></article></div></section>
        <section className="sprout-print sprout-wrap" aria-labelledby="print-title"><div><p className="sprout-eyebrow">Printed books are coming soon</p><h2 id="print-title">From your screen<br />to their bookshelf.</h2><p>The planned first print option is an A5 colour paperback. Printer page requirements are still being confirmed.</p></div><ol className="sprout-steps"><li><span className="sprout-step-number">01</span><div><h3>Review your finished book</h3><p>Check the story, illustrations and print preview before ordering.</p></div></li><li><span className="sprout-step-number">02</span><div><h3>See the full delivered price</h3><p>Choose your delivery address. See printing, postage and any tax before payment.</p></div></li><li><span className="sprout-step-number">03</span><div><h3>Printed on demand</h3><p>Once this service opens, your approved book will be sent to a print partner and delivered to your chosen address. For now, download a PDF and print at home.</p></div></li></ol></section>
        <section className="sprout-story-note" aria-labelledby="story-note-title"><div className="sprout-wrap"><BookOpen aria-hidden="true" /><p className="sprout-eyebrow">For the stories only you would think of</p><h2 id="story-note-title">A brave little fox.<br />A very shy dragon.<br />Whatever comes next.</h2><p>You choose the world. Leave room for a little wonder.</p><Link className="sprout-button" to="/app?mode=sign-up">Make a story of your own <ArrowRight aria-hidden="true" /></Link></div></section>
        <section className="sprout-faq sprout-wrap" aria-labelledby="faq-title"><div><p className="sprout-eyebrow">Before you begin</p><h2 id="faq-title">A few things<br />worth knowing.</h2><p>Start with your free PDF. Paid downloads and printed orders are still in preparation.</p></div><div className="sprout-questions">{questions.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></section>
      </main>
      <footer className="sprout-footer sprout-wrap"><Link className="sprout-brand" to="/"><Sprout aria-hidden="true" /><span translate="no">Story Sprout</span></Link><p>Little books. Made for reading together.</p><Link to="/app">Open your books <ArrowRight aria-hidden="true" /></Link></footer>
    </div>
  );
}
