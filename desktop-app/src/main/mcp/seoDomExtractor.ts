import type {ReadPageResult} from './interactions';

export type SeoData = ReadPageResult['seo'];

// This function's SOURCE (via Function.prototype.toString(), see
// READ_PAGE_SCRIPT in interactions.ts) is injected as a literal into the
// device preview's page context and run there directly — it must stay a
// pure function of its two parameters. No closures over anything outside
// this file, and only standard browser globals (URL, JSON) are available
// once it's transplanted.
//
// This is also what makes it unit-testable head-to-head against the
// regex-based fallback (parseSeo, used when JS execution is disabled): a
// jsdom Document built from the same fixture HTML should produce identical
// output from both, and a parity test in seoParity.test.ts asserts that.
export const extractSeoFromDocument = (doc: Document, currentUrl: string): SeoData => {
  const metaContent = (selector: string): string | null => {
    const el = doc.querySelector(selector);
    return el ? el.getAttribute('content') : null;
  };

  // innerText reflects rendered/visible text (respects CSS, unlike
  // textContent) and is what real browsers give here — but jsdom doesn't
  // implement it (it's always undefined there), which is what the unit
  // tests run against. Falling back to textContent keeps the tests honest
  // without changing real-browser behavior, since innerText is never
  // undefined there. Defined inside the function (not at module scope)
  // because only this function's own source gets injected into the page —
  // see the note above.
  const visibleText = (el: Element): string =>
    (el as HTMLElement).innerText ?? el.textContent ?? '';

  const getHreflangAttr = (el: Element) =>
    el.getAttribute('hreflang') || el.getAttribute('hrefLang');
  const hreflangEls = Array.from(doc.querySelectorAll('link[rel="alternate"]')).filter((el) =>
    Boolean(getHreflangAttr(el))
  );
  const hreflang = hreflangEls.map((el) => getHreflangAttr(el) as string);

  const normalizeUrl = (u: string | null): string => {
    let decoded = u || '';
    try {
      decoded = decodeURI(decoded);
    } catch {
      // Leave as-is if it isn't validly encoded.
    }
    return decoded.replace(/\/$/, '').toLowerCase();
  };

  const canonicalEls = Array.from(doc.querySelectorAll('link[rel="canonical"]'));
  const canonicalEl = canonicalEls[0];
  const canonicalHref = canonicalEl ? canonicalEl.getAttribute('href') : null;

  // The self-reference check compares against the page's CANONICAL url, not
  // its raw current url — matching Google's own hreflang guidance (each
  // entry should point at canonical URLs) and matching parseSeo's regex
  // path. Comparing against location.href instead would false-flag a page
  // as missing its own hreflang entry whenever the live URL carries a query
  // string or trailing slash the canonical doesn't have.
  const canonicalNormalized = normalizeUrl(canonicalHref);
  const hreflangHasSelfRef = hreflangEls.some(
    (el) => normalizeUrl(el.getAttribute('href')) === canonicalNormalized
  );

  const jsonLdTypes: string[] = [];
  let jsonLdParseErrors = 0;
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      const parsed = JSON.parse(el.textContent || '');
      const graph = parsed['@graph'] || [parsed];
      (graph as Array<Record<string, unknown>>).forEach((node) => {
        if (node && typeof node['@type'] === 'string') jsonLdTypes.push(node['@type'] as string);
      });
    } catch {
      jsonLdParseErrors += 1;
    }
  });

  const imgs = Array.from(doc.querySelectorAll('img'));
  let imgMissingAlt = 0;
  let imgEmptyAlt = 0;
  let imgAltOver100Chars = 0;
  imgs.forEach((img) => {
    const alt = img.getAttribute('alt');
    if (alt === null) imgMissingAlt += 1;
    else if (alt === '') imgEmptyAlt += 1;
    else if (alt.length > 100) imgAltOver100Chars += 1;
  });

  const titleEls = doc.querySelectorAll('title');
  const metaDescEls = doc.querySelectorAll('meta[name="description"]');
  const robotsMetaValue = metaContent('meta[name="robots"]');
  const robotsLower = (robotsMetaValue || '').toLowerCase();

  const anchors = Array.from(doc.querySelectorAll('a[href]'));
  const emptyAnchorTextCount = anchors.filter((a) => {
    const label = (visibleText(a) || a.getAttribute('aria-label') || '').trim();
    if (label.length > 0) return false;
    const hasDescriptiveImage = Array.from(a.querySelectorAll('img')).some(
      (img) => (img.getAttribute('alt') || '').length > 0
    );
    return !hasDescriptiveImage;
  }).length;

  let pathname = '';
  let search = '';
  try {
    const parsedUrl = new URL(currentUrl);
    pathname = parsedUrl.pathname;
    search = parsedUrl.search;
  } catch {
    // currentUrl wasn't a valid absolute URL; leave hygiene checks at their defaults.
  }

  // Cross-origin iframe content (live-casino widgets, sportsbook embeds,
  // etc.) is never visible to this function in the first place — the
  // iframe's rendered document is a separate Document object that
  // querySelectorAll/innerText on `doc` structurally cannot reach, regardless
  // of same-origin or cross-origin. This just surfaces THAT such iframes
  // exist, for audit transparency, without ever reading their content.
  let pageHostname = '';
  try {
    pageHostname = new URL(currentUrl).hostname.toLowerCase();
  } catch {
    // currentUrl wasn't a valid absolute URL; every iframe host below will
    // then be treated as external, which is the safer default.
  }
  const iframeEls = Array.from(doc.querySelectorAll('iframe'));
  const externalIframeHosts = new Set<string>();
  iframeEls.forEach((el) => {
    const src = el.getAttribute('src');
    if (!src) return;
    try {
      const hostname = new URL(src, currentUrl).hostname.toLowerCase();
      if (hostname && hostname !== pageHostname) externalIframeHosts.add(hostname);
    } catch {
      // Unparsable src (e.g. about:blank, javascript:, srcdoc-only) — skip.
    }
  });

  const h1El = doc.querySelector('h1');
  const titleText = doc.title.trim();

  return {
    titleCount: titleEls.length,
    titleLength: doc.title.length,
    metaDescription: metaContent('meta[name="description"]'),
    metaDescriptionCount: metaDescEls.length,
    canonical: canonicalHref,
    canonicalCount: canonicalEls.length,
    canonicalIsRelative: Boolean(canonicalHref && !/^https?:\/\//i.test(canonicalHref)),
    canonicalHasFragment: Boolean(canonicalHref && canonicalHref.includes('#')),
    hreflang,
    hreflangHasSelf: hreflang.length === 0 || hreflangHasSelfRef,
    ogComplete: Boolean(
      doc.querySelector('meta[property="og:title"]') &&
      doc.querySelector('meta[property="og:description"]') &&
      doc.querySelector('meta[property="og:image"]')
    ),
    twitterCard: Boolean(doc.querySelector('meta[name^="twitter:"], meta[property^="twitter:"]')),
    jsonLdTypes,
    jsonLdParseErrors,
    h1Count: doc.querySelectorAll('h1').length,
    h2Count: doc.querySelectorAll('h2').length,
    h1SameAsTitle: Boolean(h1El && titleText.length > 0 && visibleText(h1El).trim() === titleText),
    robotsMeta: robotsMetaValue,
    robotsNoindex: robotsLower.includes('noindex'),
    robotsNofollow: robotsLower.includes('nofollow'),
    viewportSet: Boolean(doc.querySelector('meta[name="viewport"]')),
    imgTotal: imgs.length,
    imgMissingAlt,
    imgEmptyAlt,
    imgAltOver100Chars,
    emptyAnchorTextCount,
    urlHasNonAscii: Array.from(currentUrl).some((ch) => (ch.codePointAt(0) ?? 0) > 127),
    urlHasUppercase: /[A-Z]/.test(pathname),
    urlHasTrackingParams: /[?&](utm_|gclid|fbclid)/i.test(search),
    iframeCount: iframeEls.length,
    iframeExternalDomains: Array.from(externalIframeHosts),
  };
};
