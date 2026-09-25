import {describe, expect, it} from 'vitest';
import {extractSeoFromDocument} from './seoDomExtractor';
import {parseSeo} from './seoParser';

// Guards against the live-DOM extraction (used when JS is enabled) and the
// regex-over-raw-HTML fallback (used when JS execution is disabled) silently
// drifting apart. If someone edits one path's rules without updating the
// other, this fails instead of a device toggle producing a false SEO
// difference between two previews of the same page.
const CURRENT_URL = 'https://example.com/products/Shoes?utm_source=newsletter';

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Best Running Shoes | Example Store</title>
  <meta name="description" content="Shop the best running shoes at Example Store.">
  <link rel="canonical" href="https://example.com/products/shoes">
  <link rel="alternate" hreflang="en" href="https://example.com/products/shoes">
  <link rel="alternate" hreflang="es" href="https://example.com/es/products/shoes">
  <meta property="og:title" content="Best Running Shoes">
  <meta property="og:description" content="Shop the best running shoes.">
  <meta property="og:image" content="https://example.com/shoes.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="robots" content="index, follow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product","name":"Running Shoes"}
  </script>
</head>
<body>
  <h1>Running Shoes Collection</h1>
  <h2>Men's</h2>
  <h2>Women's</h2>
  <img src="/a.jpg">
  <img src="/b.jpg" alt="">
  <img src="/c.jpg" alt="A very long piece of alt text that goes on and on and on and on and on and on and on and on and on and keeps going past one hundred characters total length for sure">
  <img src="/d.jpg" alt="Running shoe on white background">
  <a href="/checkout"></a>
  <a href="/cart"><img src="/cart-icon.png" alt="Shopping cart"></a>
  <a href="/about">About us</a>
</body>
</html>`;

describe('seo extraction parity (live DOM vs regex fallback)', () => {
  it('produces identical seo output for the same page', () => {
    const doc = new DOMParser().parseFromString(FIXTURE_HTML, 'text/html');
    const domResult = extractSeoFromDocument(doc, CURRENT_URL);
    const regexResult = parseSeo(FIXTURE_HTML, CURRENT_URL);
    expect(domResult).toEqual(regexResult);
  });

  it('treats an empty title and empty h1 as NOT matching (both paths)', () => {
    const html = '<!doctype html><html><head><title></title></head><body><h1></h1></body></html>';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const domResult = extractSeoFromDocument(doc, 'https://example.com/');
    const regexResult = parseSeo(html, 'https://example.com/');
    expect(domResult.h1SameAsTitle).toBe(false);
    expect(regexResult.h1SameAsTitle).toBe(false);
    expect(domResult).toEqual(regexResult);
  });

  it('flags URL hygiene identically on both paths', () => {
    const html = '<!doctype html><html><head><title>t</title></head><body></body></html>';
    const url = 'https://example.com/Some-Path?gclid=abc123';
    const domResult = extractSeoFromDocument(
      new DOMParser().parseFromString(html, 'text/html'),
      url
    );
    const regexResult = parseSeo(html, url);
    expect(domResult.urlHasUppercase).toBe(true);
    expect(domResult.urlHasTrackingParams).toBe(true);
    expect(domResult).toEqual(regexResult);
  });
});
