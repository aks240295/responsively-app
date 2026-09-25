import type {ReadPageResult} from './interactions';

export type SeoSeverity = 'critical' | 'warning' | 'opportunity';

export interface SeoFinding {
  id: string;
  severity: SeoSeverity;
  message: string;
}

export interface SeoAuditReport {
  counts: Record<SeoSeverity, number>;
  findings: SeoFinding[];
}

type SeoData = ReadPageResult['seo'];

interface SeoCheck {
  id: string;
  severity: SeoSeverity;
  test: (seo: SeoData) => boolean;
  message: (seo: SeoData) => string;
}

// Severity buckets mirror Screaming Frog's Issue/Warning/Opportunity
// taxonomy: critical = would hurt indexing/ranking outright, warning = worth
// fixing but not urgent, opportunity = minor hygiene. Fixed here (rather than
// left to whichever AI happens to be narrating the read_page result) so the
// same page always gets the same classification.
const CHECKS: SeoCheck[] = [
  {
    id: 'title-missing',
    severity: 'critical',
    test: (seo) => seo.titleCount === 0 || seo.titleLength === 0,
    message: () => 'Page has no <title>.',
  },
  {
    id: 'title-duplicate',
    severity: 'critical',
    test: (seo) => seo.titleCount > 1,
    message: (seo) => `Page has ${seo.titleCount} <title> tags; only the first is used.`,
  },
  {
    id: 'meta-description-missing',
    severity: 'warning',
    test: (seo) => seo.metaDescriptionCount === 0 || !seo.metaDescription,
    message: () => 'Page has no meta description.',
  },
  {
    id: 'meta-description-duplicate',
    severity: 'warning',
    test: (seo) => seo.metaDescriptionCount > 1,
    message: (seo) => `Page has ${seo.metaDescriptionCount} meta description tags.`,
  },
  {
    id: 'canonical-missing',
    severity: 'warning',
    test: (seo) => seo.canonicalCount === 0,
    message: () => 'Page has no canonical link.',
  },
  {
    id: 'canonical-duplicate',
    severity: 'critical',
    test: (seo) => seo.canonicalCount > 1,
    message: (seo) =>
      `Page has ${seo.canonicalCount} canonical links; conflicting canonicals confuse crawlers.`,
  },
  {
    id: 'canonical-relative',
    severity: 'warning',
    test: (seo) => seo.canonicalCount > 0 && seo.canonicalIsRelative,
    message: () => 'Canonical URL is relative; use an absolute URL.',
  },
  {
    id: 'canonical-has-fragment',
    severity: 'warning',
    test: (seo) => seo.canonicalCount > 0 && seo.canonicalHasFragment,
    message: () => 'Canonical URL contains a # fragment, which crawlers ignore or strip.',
  },
  {
    id: 'hreflang-missing-self',
    severity: 'critical',
    test: (seo) => seo.hreflang.length > 0 && !seo.hreflangHasSelf,
    message: () => 'hreflang set has no self-referencing entry for this page’s canonical URL.',
  },
  {
    id: 'og-incomplete',
    severity: 'warning',
    test: (seo) => !seo.ogComplete,
    message: () => 'Open Graph tags are incomplete (needs og:title, og:description, og:image).',
  },
  {
    id: 'twitter-card-missing',
    severity: 'opportunity',
    test: (seo) => !seo.twitterCard,
    message: () => 'No Twitter Card meta tags.',
  },
  {
    id: 'json-ld-parse-error',
    severity: 'critical',
    test: (seo) => seo.jsonLdParseErrors > 0,
    message: (seo) => `${seo.jsonLdParseErrors} JSON-LD block(s) failed to parse.`,
  },
  {
    id: 'h1-missing',
    severity: 'critical',
    test: (seo) => seo.h1Count === 0,
    message: () => 'Page has no <h1>.',
  },
  {
    id: 'h1-duplicate',
    severity: 'warning',
    test: (seo) => seo.h1Count > 1,
    message: (seo) => `Page has ${seo.h1Count} <h1> tags.`,
  },
  {
    id: 'robots-noindex',
    severity: 'critical',
    test: (seo) => seo.robotsNoindex,
    message: () => 'Page has a robots noindex directive.',
  },
  {
    id: 'robots-nofollow',
    severity: 'warning',
    test: (seo) => seo.robotsNofollow,
    message: () => 'Page has a robots nofollow directive.',
  },
  {
    id: 'viewport-missing',
    severity: 'critical',
    test: (seo) => !seo.viewportSet,
    message: () => 'Page has no viewport meta tag; mobile rendering will be affected.',
  },
  {
    id: 'images-missing-alt',
    severity: 'warning',
    test: (seo) => seo.imgMissingAlt > 0,
    message: (seo) => `${seo.imgMissingAlt} of ${seo.imgTotal} images have no alt attribute.`,
  },
  {
    id: 'images-alt-too-long',
    severity: 'opportunity',
    test: (seo) => seo.imgAltOver100Chars > 0,
    message: (seo) => `${seo.imgAltOver100Chars} image(s) have alt text over 100 characters.`,
  },
  {
    id: 'empty-anchor-text',
    severity: 'warning',
    test: (seo) => seo.emptyAnchorTextCount > 0,
    message: (seo) => `${seo.emptyAnchorTextCount} link(s) have no accessible text.`,
  },
  {
    id: 'url-has-non-ascii',
    severity: 'opportunity',
    test: (seo) => seo.urlHasNonAscii,
    message: () => 'URL contains non-ASCII characters.',
  },
  {
    id: 'url-has-uppercase',
    severity: 'opportunity',
    test: (seo) => seo.urlHasUppercase,
    message: () => 'URL path contains uppercase characters.',
  },
  {
    id: 'url-has-tracking-params',
    severity: 'opportunity',
    test: (seo) => seo.urlHasTrackingParams,
    message: () => 'URL contains tracking parameters (utm_/gclid/fbclid).',
  },
];

export const buildSeoAuditReport = (seo: SeoData): SeoAuditReport => {
  const findings: SeoFinding[] = CHECKS.filter((check) => check.test(seo)).map((check) => ({
    id: check.id,
    severity: check.severity,
    message: check.message(seo),
  }));
  const counts: Record<SeoSeverity, number> = {critical: 0, warning: 0, opportunity: 0};
  findings.forEach((finding) => {
    counts[finding.severity] += 1;
  });
  return {counts, findings};
};
