// Regex-based SEO/content extraction over a raw HTML string. Used as the
// fallback path for read_page when a page has JavaScript execution disabled
// (Emulation.setScriptExecutionDisabled): CDP's DOM domain can still return
// the parsed document as a string (DOM.getOuterHTML) without running any
// script, but there's no live DOM to query with selectors — so this parses
// the markup directly instead, the same way the raw-HTTP SEO audit does.
import {ReadPageResult} from './interactions';

const attr = (tag: string, name: string): string | null => {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
};

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

const stripTags = (html: string): string =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '\n\n')
      .trim()
  );

export const extractTitle = (html: string): string => {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).trim() : '';
};

export const parseSeo = (html: string): ReadPageResult['seo'] => {
  const titleMatches = html.match(/<title[^>]*>/gi) || [];
  const metaDescMatches = Array.from(
    html.matchAll(/<meta\s+[^>]*name\s*=\s*["']description["'][^>]*>/gi)
  );
  const metaDescription =
    metaDescMatches.length > 0 ? attr(metaDescMatches[0][0], 'content') : null;

  const canonicalMatches = Array.from(
    html.matchAll(/<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*>/gi)
  );
  const canonical = canonicalMatches.length > 0 ? attr(canonicalMatches[0][0], 'href') : null;

  const hreflangMatches = Array.from(
    html.matchAll(/<link\s+[^>]*rel\s*=\s*["']alternate["'][^>]*>/gi)
  ).filter((m) => attr(m[0], 'hreflang') !== null);
  const hreflang = hreflangMatches.map((m) => attr(m[0], 'hreflang') as string);
  const normalizeUrl = (u: string | null) => {
    if (!u) return '';
    let decoded = u;
    try {
      decoded = decodeURI(u);
    } catch {
      // leave as-is if not validly encoded
    }
    return decoded.replace(/\/$/, '').toLowerCase();
  };
  const canonicalNormalized = normalizeUrl(canonical);
  const hreflangHasSelf =
    hreflang.length === 0 ||
    hreflangMatches.some((m) => normalizeUrl(attr(m[0], 'href')) === canonicalNormalized);

  const hasOgTag = (prop: string) =>
    new RegExp(`<meta\\s+[^>]*property\\s*=\\s*["']${prop}["']`, 'i').test(html);
  const ogComplete = hasOgTag('og:title') && hasOgTag('og:description') && hasOgTag('og:image');
  const twitterCard = /<meta\s+[^>]*(name|property)\s*=\s*["']twitter:/i.test(html);

  const jsonLdBlocks = Array.from(
    html.matchAll(
      /<script\s+[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )
  );
  const jsonLdTypes: string[] = [];
  let jsonLdParseErrors = 0;
  jsonLdBlocks.forEach((m) => {
    try {
      const parsed = JSON.parse(m[1]);
      const graph = parsed['@graph'] || [parsed];
      (graph as Array<Record<string, unknown>>).forEach((node) => {
        if (node && typeof node['@type'] === 'string') jsonLdTypes.push(node['@type'] as string);
      });
    } catch {
      jsonLdParseErrors += 1;
    }
  });

  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  const h2Count = (html.match(/<h2[\s>]/gi) || []).length;
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1SameAsTitle = Boolean(
    h1Match &&
    stripTags(h1Match[1]).trim() === extractTitle(html).trim() &&
    extractTitle(html).trim().length > 0
  );

  const robotsMatches = Array.from(html.matchAll(/<meta\s+[^>]*name\s*=\s*["']robots["'][^>]*>/gi));
  const robotsMeta = robotsMatches.length > 0 ? attr(robotsMatches[0][0], 'content') : null;
  const robotsLower = (robotsMeta || '').toLowerCase();

  const viewportSet = /<meta\s+[^>]*name\s*=\s*["']viewport["']/i.test(html);

  const imgTags = Array.from(html.matchAll(/<img\b[^>]*>/gi)).map((m) => m[0]);
  let imgMissingAlt = 0;
  let imgEmptyAlt = 0;
  let imgAltOver100Chars = 0;
  imgTags.forEach((tag) => {
    const alt = attr(tag, 'alt');
    if (alt === null) imgMissingAlt += 1;
    else if (alt === '') imgEmptyAlt += 1;
    else if (alt.length > 100) imgAltOver100Chars += 1;
  });

  const anchorBlocks = Array.from(
    html.matchAll(/<a\s+[^>]*href\s*=\s*["'][^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)
  );
  const emptyAnchorTextCount = anchorBlocks.filter((m) => {
    const label = stripTags(m[1]).trim();
    if (label.length > 0) return false;
    const hasDescriptiveImage = /<img\b[^>]*alt\s*=\s*["'][^"']+["']/i.test(m[1]);
    return !hasDescriptiveImage;
  }).length;

  return {
    titleCount: titleMatches.length,
    titleLength: extractTitle(html).length,
    metaDescription,
    metaDescriptionCount: metaDescMatches.length,
    canonical,
    canonicalCount: canonicalMatches.length,
    canonicalIsRelative: Boolean(canonical && !/^https?:\/\//i.test(canonical)),
    canonicalHasFragment: Boolean(canonical && canonical.includes('#')),
    hreflang,
    hreflangHasSelf,
    ogComplete,
    twitterCard,
    jsonLdTypes,
    jsonLdParseErrors,
    h1Count,
    h2Count,
    h1SameAsTitle,
    robotsMeta,
    robotsNoindex: robotsLower.includes('noindex'),
    robotsNofollow: robotsLower.includes('nofollow'),
    viewportSet,
    imgTotal: imgTags.length,
    imgMissingAlt,
    imgEmptyAlt,
    imgAltOver100Chars,
    emptyAnchorTextCount,
    urlHasNonAscii: false,
    urlHasUppercase: false,
    urlHasTrackingParams: false,
  };
};

const MAX_ELEMENTS = 100;
const MAX_TEXT = 3000;

export interface ParsedElement {
  selector: string;
  tag: string;
  text: string;
  href?: string;
}

// Best-effort only: without a live DOM there's no way to filter to visible
// elements or compute a real CSS path, so this counts occurrences per tag
// name to build an nth-of-type-shaped selector. It's good enough to see
// what links/buttons/inputs exist on a JS-disabled page, not to click them
// (nothing is clickable there anyway — the handlers never attached).
export const parseElements = (html: string): {elements: ParsedElement[]; truncated: boolean} => {
  const tagCounters = new Map<string, number>();
  const nextSelector = (tag: string) => {
    const n = (tagCounters.get(tag) ?? 0) + 1;
    tagCounters.set(tag, n);
    return `${tag}:nth-of-type(${n})`;
  };

  const candidates = Array.from(html.matchAll(/<(a|button|input)\b[^>]*?(\/?>|>[\s\S]*?<\/\1>)/gi));
  const elements: ParsedElement[] = [];
  for (const m of candidates) {
    if (elements.length >= MAX_ELEMENTS) break;
    const wholeTag = m[0];
    const tagName = m[1].toLowerCase();
    const selector = nextSelector(tagName);
    if (tagName === 'a') {
      const href = attr(wholeTag, 'href');
      const inner = wholeTag.replace(/^<a[^>]*>/i, '').replace(/<\/a>$/i, '');
      elements.push({
        selector,
        tag: 'a',
        text: stripTags(inner).slice(0, 80),
        href: href ?? undefined,
      });
    } else if (tagName === 'button') {
      const inner = wholeTag.replace(/^<button[^>]*>/i, '').replace(/<\/button>$/i, '');
      elements.push({selector, tag: 'button', text: stripTags(inner).slice(0, 80)});
    } else if (tagName === 'input') {
      const placeholder = attr(wholeTag, 'placeholder') || '';
      elements.push({selector, tag: 'input', text: placeholder.slice(0, 80)});
    }
  }
  return {elements, truncated: candidates.length > MAX_ELEMENTS};
};

export const extractBodyText = (html: string): string => {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  return stripTags(body).slice(0, MAX_TEXT);
};
