import {describe, expect, it} from 'vitest';
import {parseSeo} from './seoParser';
import {buildSeoAuditReport} from './seoAudit';

const GOOD_HTML = `<!doctype html>
<html>
<head>
  <title>A Perfectly Fine Page</title>
  <meta name="description" content="A description that exists.">
  <link rel="canonical" href="https://example.com/page">
  <meta property="og:title" content="A Perfectly Fine Page">
  <meta property="og:description" content="A description that exists.">
  <meta property="og:image" content="https://example.com/image.jpg">
  <meta name="twitter:card" content="summary">
  <meta name="robots" content="index, follow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <h1>A Different Heading</h1>
  <img src="/a.jpg" alt="Fine">
  <a href="/x">Link text</a>
</body>
</html>`;

const BAD_HTML = `<!doctype html>
<html>
<head></head>
<body>
  <img src="/a.jpg">
  <a href="/x"></a>
</body>
</html>`;

describe('buildSeoAuditReport', () => {
  it('reports no findings for a clean page', () => {
    const seo = parseSeo(GOOD_HTML, 'https://example.com/page');
    const report = buildSeoAuditReport(seo);
    expect(report.findings).toEqual([]);
    expect(report.counts).toEqual({critical: 0, warning: 0, opportunity: 0});
  });

  it('flags missing title, h1, viewport and robots-noindex-worthy gaps as critical', () => {
    const seo = parseSeo(BAD_HTML, 'https://example.com/bad');
    const report = buildSeoAuditReport(seo);
    const ids = report.findings.map((f) => f.id);
    expect(ids).toContain('title-missing');
    expect(ids).toContain('h1-missing');
    expect(ids).toContain('viewport-missing');
    expect(report.counts.critical).toBeGreaterThan(0);
  });

  it('classifies severity consistently — same input always yields the same buckets', () => {
    const seo = parseSeo(BAD_HTML, 'https://example.com/bad');
    const reportA = buildSeoAuditReport(seo);
    const reportB = buildSeoAuditReport(seo);
    expect(reportA).toEqual(reportB);
  });
});
