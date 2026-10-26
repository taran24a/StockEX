import { useQuery } from "@tanstack/react-query";
import { QuotesResponseSchema } from "@tradewise/shared";
import { Link } from "react-router-dom";
import { apiRequest } from "./api";
import { useAuth } from "./auth";
import { TradeWiseLogo } from "./components/TradeWiseLogo";
import { formatPaise } from "./format";

const quoteQueryKey = ["landing", "quotes"];

function getChangeLabel(changePaise: number): string {
  if (changePaise === 0) {
    return "No change";
  }
  return `${changePaise > 0 ? "Up" : "Down"} ${formatPaise(Math.abs(changePaise))}`;
}

function QuoteTicker() {
  const query = useQuery({
    queryKey: quoteQueryKey,
    queryFn: () => apiRequest("/api/quotes", QuotesResponseSchema),
    refetchInterval: 10_000
  });
  const quotes = query.data?.quotes ?? [];

  return (
    <section aria-label="Application market feed" className="landing-ticker">
      <div className="landing-ticker-label">
        <span aria-hidden="true" className="landing-live-dot" />
        <span>App market feed</span>
      </div>
      {query.isPending ? (
        <p className="landing-ticker-state" role="status">Loading market feed…</p>
      ) : query.isError ? (
        <p className="landing-ticker-state landing-error" role="alert">
          Market feed is temporarily unavailable.
        </p>
      ) : quotes.length === 0 ? (
        <p className="landing-ticker-state">No market quotes are available right now.</p>
      ) : (
        <ul className="landing-ticker-list">
          {quotes.slice(0, 8).map((quote) => (
            <li className="landing-ticker-item" key={quote.symbol}>
              <span className="landing-ticker-symbol">{quote.symbol}</span>
              <span className="landing-ticker-price">{formatPaise(quote.pricePaise)}</span>
              <span
                className={`landing-ticker-change ${quote.changePaise > 0 ? "is-up" : quote.changePaise < 0 ? "is-down" : "is-flat"}`}
                aria-label={getChangeLabel(quote.changePaise)}
              >
                <span aria-hidden="true">{quote.changePaise > 0 ? "↑" : quote.changePaise < 0 ? "↓" : "—"}</span>
                {quote.changePaise === 0 ? "Flat" : formatPaise(Math.abs(quote.changePaise))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MarketPreview() {
  return (
    <aside aria-label="Illustrative workspace preview, not account data" className="landing-market-panel">
      <div className="landing-market-head">
        <div>
          <p className="landing-overline">Workspace preview / illustrative</p>
          <h2 className="landing-market-name">Practice portfolio</h2>
          <p className="landing-market-company">Example view · not account data</p>
        </div>
        <span className="landing-market-live"><span aria-hidden="true" />SAMPLE VIEW</span>
      </div>
      <div className="landing-market-price">
        ₹1,24,680
        <span className="landing-preview-caption">Illustrative virtual balance</span>
      </div>
      <div aria-hidden="true" className="landing-chart landing-preview-chart">
        <div className="landing-preview-grid" />
        <svg viewBox="0 0 520 190" preserveAspectRatio="none">
          <defs><linearGradient id="preview-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#69cfff" stopOpacity=".24" /><stop offset="1" stopColor="#69cfff" stopOpacity="0" /></linearGradient></defs>
          <path className="landing-preview-area" d="M0 151 C35 138 52 154 83 127 S132 129 158 109 S195 127 222 91 S260 100 287 79 S326 104 355 65 S397 82 426 53 S475 60 520 23 V190 H0Z" />
          <path className="landing-preview-line" d="M0 151 C35 138 52 154 83 127 S132 129 158 109 S195 127 222 91 S260 100 287 79 S326 104 355 65 S397 82 426 53 S475 60 520 23" />
        </svg>
        <div className="landing-preview-chart-labels"><span>MON</span><span>WED</span><span>FRI</span><span>SAMPLE</span></div>
      </div>
      <div className="landing-preview-holdings">
        <div><span>Virtual holdings</span><strong>3 positions</strong></div>
        <div><span>Orders</span><strong>Practice only</strong></div>
      </div>
      <div className="landing-chart-foot">
        <span>ILLUSTRATIVE DATA</span>
        <span>NOT CONNECTED TO YOUR ACCOUNT</span>
      </div>
    </aside>
  );
}

const features = [
  {
    number: "01",
    title: "Explainable orders",
    copy: "See the price, quantity, and estimated value before you place a simulated order."
  },
  {
    number: "02",
    title: "Risk guardian",
    copy: "Checks can flag insufficient funds and other order constraints before execution."
  },
  {
    number: "03",
    title: "Trade replay",
    copy: "Review simulated fills and the decisions around them, then learn from the outcome."
  },
  {
    number: "04",
    title: "Real-time updates",
    copy: "Follow the app’s market feed as quotes change—without placing a real trade."
  },
  {
    number: "05",
    title: "Paper money only",
    copy: "Practice in a virtual portfolio. No deposits, real orders, or investment advice."
  }
];

const faqs = [
  {
    question: "Does TradeWise use real money?",
    answer: "No. TradeWise is a paper-trading simulator. Orders and portfolio activity use virtual money only."
  },
  {
    question: "Are quotes and simulated fills the same thing?",
    answer: "No. Quotes come from the app’s market data feed. A simulated fill is a learning exercise inside TradeWise and is not sent to an exchange."
  },
  {
    question: "Can I review a trade or a risk check?",
    answer: "Yes. The workspace includes simulated order history and trade replay features so you can review what happened."
  },
  {
    question: "Is TradeWise financial advice?",
    answer: "No. TradeWise is an educational practice tool and does not provide financial advice or recommendations."
  }
];

export function LandingPage() {
  const { user } = useAuth();
  const dashboardPath = "/app/dashboard";
  const primaryPath = user === null ? "/register" : dashboardPath;

  return (
    <div className="landing-page">
      <a className="landing-skip-link" href="#main-content">Skip to content</a>
      <header className="landing-header">
        <nav aria-label="Main navigation" className="landing-nav">
          <Link aria-label="TradeWise home" className="landing-brand" to="/">
            <TradeWiseLogo className="landing-logo" />
          </Link>
          <div className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
          </div>
          <div className="landing-nav-actions">
            <Link className="landing-login" to="/login">Log in</Link>
            <Link className="landing-nav-cta" to={primaryPath}>
              {user === null ? "Get started" : "Open dashboard"}
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </nav>
      </header>

      <main id="main-content">
        <section aria-labelledby="hero-title" className="landing-hero landing-shell">
          <div className="landing-hero-copy">
            <p className="landing-kicker"><span aria-hidden="true" />A practice space for the curious</p>
            <h1 aria-label="Trade smarter. See the market differently." id="hero-title">
              Trade smarter.<br /><span>See the market differently.</span>
            </h1>
            <p className="landing-hero-description">
              Learn how orders, prices, and risk work—using virtual funds in a market simulator built for practice, not promises.
            </p>
            <div className="landing-hero-actions">
              <Link className="landing-primary-cta" to={primaryPath}>
                {user === null ? "Start practicing" : "Go to your dashboard"}
                <span aria-hidden="true">→</span>
              </Link>
              <a className="landing-secondary-cta" href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
            </div>
            <p className="landing-hero-note"><span aria-hidden="true">◈</span> No deposits. No real trades. Just a place to learn.</p>
          </div>
          <MarketPreview />
          <div className="landing-hero-index" aria-hidden="true">TRADEWISE / LEARNING TERMINAL <span>001—005</span></div>
        </section>

        <div className="landing-shell"><QuoteTicker /></div>

        <section aria-labelledby="features-title" className="landing-section landing-shell" id="features">
          <div className="landing-section-heading">
            <p className="landing-overline">The learning toolkit / 01</p>
            <h2 id="features-title">A better way to<br /><span>learn the mechanics.</span></h2>
            <p>Get to know the moving parts of a trade in a space designed to make every step visible.</p>
          </div>
          <div className="landing-feature-list">
            {features.map((feature) => (
              <article className="landing-feature" key={feature.number}>
                <span className="landing-feature-number">{feature.number}</span>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
                <span aria-hidden="true" className="landing-feature-arrow">↗</span>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="steps-title" className="landing-how" id="how-it-works">
          <div className="landing-shell landing-how-inner">
            <div className="landing-section-heading">
              <p className="landing-overline">A simple loop / 02</p>
              <h2 id="steps-title">Learn by doing.<br /><span>Reflect as you go.</span></h2>
              <p>Start with a market observation. Finish with a clearer picture of your decisions.</p>
            </div>
            <ol className="landing-steps">
              <li><span className="landing-step-number">01</span><div><h3>Explore the market</h3><p>Choose an instrument and observe its changing quote.</p></div></li>
              <li><span className="landing-step-number">02</span><div><h3>Place a practice order</h3><p>Set a quantity, review the details, and see how checks apply.</p></div></li>
              <li><span className="landing-step-number">03</span><div><h3>Review what happened</h3><p>Revisit the simulated outcome and build your understanding.</p></div></li>
            </ol>
          </div>
        </section>

        <section aria-labelledby="difference-title" className="landing-section landing-shell landing-difference">
          <div className="landing-difference-heading">
            <p className="landing-overline">Made for understanding / 03</p>
            <h2 id="difference-title">The point isn’t the profit.<br /><span>It’s the process.</span></h2>
          </div>
          <div aria-label="TradeWise learning trace" className="landing-trace" role="group">
            <article className="landing-trace-stage">
              <span className="landing-trace-index">01 / INPUT</span>
              <h3>Observe</h3>
              <p>Start with a market quote and the context around it.</p>
            </article>
            <article className="landing-trace-stage">
              <span className="landing-trace-index">02 / DECISION</span>
              <h3>Check</h3>
              <p>Review order details and risk checks before a practice order.</p>
            </article>
            <article className="landing-trace-stage">
              <span className="landing-trace-index">03 / LEARNING</span>
              <h3>Reflect</h3>
              <p>Revisit the simulated result and connect it to your decision.</p>
            </article>
          </div>
        </section>

        <section aria-labelledby="faq-title" className="landing-faq landing-shell">
          <div className="landing-section-heading">
            <p className="landing-overline">Good to know / 04</p>
            <h2 id="faq-title">Questions, <span>answered.</span></h2>
          </div>
          <div className="landing-faq-list">
            {faqs.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}<span aria-hidden="true">+</span></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="landing-final-cta-title" className="landing-final-cta landing-shell">
          <p className="landing-overline">Your next move / 05</p>
          <h2 id="landing-final-cta-title">Build your market instincts.<br /><span>One practice trade at a time.</span></h2>
          <p>Explore the app with virtual money. No deposits, real trades, or investment advice.</p>
          <div className="landing-final-cta-actions">
            <Link className="landing-primary-cta" to={primaryPath}>
              {user === null ? "Start practicing" : "Open your dashboard"}
              <span aria-hidden="true">→</span>
            </Link>
            <Link className="landing-secondary-cta" to={user === null ? "/login" : "/app/markets"}>
              {user === null ? "Already have an account? Sign in" : "Explore markets"}
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-shell landing-footer-inner">
          <Link aria-label="TradeWise home" className="landing-brand" to="/">
            <TradeWiseLogo className="landing-logo" />
          </Link>
          <p>Simulated trading with virtual money. Not financial advice.</p>
          <span className="landing-footer-meta">BUILT FOR PRACTICE · NEVER A BROKER</span>
        </div>
      </footer>
    </div>
  );
}
