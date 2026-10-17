# /geo

Optimizes your site to be **cited by AI** (ChatGPT, Claude, Perplexity, Gemini, Copilot, Google's AI Overviews). Complementary to `/seo`: a site that ranks well on Google is not necessarily cited by AI, and vice versa.

## When to use it

- Your site has **informative content** (articles, FAQ, tutorials, documentation, blog) that AI could cite when answering its users' questions
- You want to **become a reference source** for the questions people ask AI in your field
- You have already run `/seo` and want to cover the "AI" channel too

## How it goes

1. **SEO preflight**: Hypervibe first checks that the classic SEO foundations are in place (metadata, sitemap, robots.txt, JSON-LD WebSite) and reuses what `/seo` already checked. A page that Google cannot index properly will not be viewed favorably by AI either. If something is missing, Hypervibe suggests `/seo` first.

2. **Can AI robots read your pages?** The most important point, so it comes first:
  - **Text without JavaScript**: almost no AI robot runs JavaScript. Hypervibe loads your pages the way they do and checks that their main text is in the HTML. A page whose text is drawn in the browser is empty for them, however good it looks.
  - **The firewall**: Cloudflare, where Hypervibe puts your domains, blocks AI robots by default on new domains since July 2025. Hypervibe reads that setting on your domain.
  - **robots.txt**: what it says to each AI robot, read in a dated and sourced list (each robot, its operator, its role: filling an AI engine's search index, fetching a page on request during a chat, or collecting pages to train models).

3. **Citable content**: question/answer format and blocks that stand on their own, citability signals (dates, figures, sources), E-E-A-T signals (experience, expertise, authority, trust). Automatic detections are hints to re-read, not faults.

4. **The bets, presented as such**: the `llms.txt` file (no major engine confirms reading it for its answers; it costs nothing) and FAQ markup (plausible help, not demonstrated).

5. **IndexNow (optional)**: for a site that publishes regularly, notifies Bing (whose index also serves Copilot) on each publication.

6. **A computed score, not a judged one**: a fixed grid, and the result kept in the project, to compare from one pass to the next.

7. **Proposed and applied fixes**: text rendered on the server, robots.txt rules according to your choice, structured data, content proposals (which you approve).

## What it creates for you

- The rules for AI robots in your robots.txt, according to your choice: let them all in, be cited without feeding training, or keep them all out
- Pages whose text reads without JavaScript, if some did not
- If you want them: an `llms.txt`, FAQ markup, IndexNow
- Rewrite suggestions for citability (figures, dates, sources)
- A report and its score, kept in the project for next time
- A guided check of your citations: the questions your customers ask, put to the AIs, cited or not

## Prerequisites

- Basic SEO must be in place (`/seo` beforehand if needed)
- Your site must have **informative content**: a simple showcase site with no content does not really have material to be cited by AI

## Tips

{{callout:tip|GEO = a new visibility channel}}
Classic SEO makes you appear in Google results (the blue list). GEO aims to **be cited by AI in its answers**. The two are not identical: a site on Google's first page may not be cited by ChatGPT, and vice versa. The more searches go through AI, the more GEO matters.
{{/callout}}

{{callout:warning|First, the robots must be able to read}}
The best content is useless if AI robots cannot see it: a page whose text is drawn by JavaScript, or a domain whose firewall turns them away, will never be cited. That is where Hypervibe starts.
{{/callout}}

{{callout:info|llms.txt = a bet, not a standard}}
The `llms.txt` file was proposed by Jeremy Howard (Answer.AI) in September 2024. No major AI engine has confirmed reading it to build its answers, and Google says its search ignores it. It costs nothing: Hypervibe offers it, without presenting it as a guarantee.
{{/callout}}

{{callout:warning|Citability = figures + dates + sources}}
For an AI to cite you, it must **trust** your content. The key signals: precise figures (not "many users" but "12% of users"), explicit dates (not "recently" but "in March 2026"), and links to the sources you cite. Hypervibe can suggest these enrichments page by page.
{{/callout}}
