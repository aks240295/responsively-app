import {webContents} from 'electron';
import {McpCaptureTargetsResult} from '../../common/mcp';
import {isRegisteredWebview} from '../webview-registry';
import {GetMainWindow, sendBridgeCommand} from './bridge';
import {buildSeoAuditReport, SeoAuditReport} from './seoAudit';
import {extractSeoFromDocument} from './seoDomExtractor';
import {extractBodyText, extractTitle, parseElements, parseSeo} from './seoParser';

const EXECUTE_TIMEOUT_MS = 10_000;
const POST_INPUT_SETTLE_MS = 500;

export interface ReadPageResult {
  deviceName: string;
  url: string;
  title: string;
  text: string;
  elements: Array<{
    selector: string;
    tag: string;
    text: string;
    value?: string;
    inputType?: string;
    href?: string;
    disabled?: boolean;
  }>;
  truncatedElements: boolean;
  seo: {
    titleCount: number;
    titleLength: number;
    metaDescription: string | null;
    metaDescriptionCount: number;
    canonical: string | null;
    canonicalCount: number;
    canonicalIsRelative: boolean;
    canonicalHasFragment: boolean;
    hreflang: string[];
    hreflangHasSelf: boolean;
    ogComplete: boolean;
    twitterCard: boolean;
    jsonLdTypes: string[];
    jsonLdParseErrors: number;
    h1Count: number;
    h2Count: number;
    h1SameAsTitle: boolean;
    robotsMeta: string | null;
    robotsNoindex: boolean;
    robotsNofollow: boolean;
    viewportSet: boolean;
    imgTotal: number;
    imgMissingAlt: number;
    imgEmptyAlt: number;
    imgAltOver100Chars: number;
    emptyAnchorTextCount: number;
    urlHasNonAscii: boolean;
    urlHasUppercase: boolean;
    urlHasTrackingParams: boolean;
    iframeCount: number;
    iframeExternalDomains: string[];
  };
  report: SeoAuditReport;
}

export interface ClickResult {
  deviceName: string;
  clicked: {tag: string; text: string};
  url: string;
  pageTitle: string;
}

export interface TypeTextResult {
  deviceName: string;
  value: string;
  url: string;
  pageTitle: string;
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// A webview freshly (re)created by a reload/toggle can take a moment to
// reach dom-ready; until then getWebContentsId() throws and the bridge
// reports it as "still loading". That's transient, not a real absence, so
// it's worth a few short retries before surfacing the error to the caller.
const STILL_LOADING_RETRY_ATTEMPTS = 4;
const STILL_LOADING_RETRY_DELAY_MS = 500;

const resolveTarget = async (
  getMainWindow: GetMainWindow,
  device?: string
): Promise<{deviceName: string; targetContents: Electron.WebContents}> => {
  let targets: McpCaptureTargetsResult['targets'] = [];
  let skipped: McpCaptureTargetsResult['skipped'] = [];
  for (let attempt = 1; attempt <= STILL_LOADING_RETRY_ATTEMPTS; attempt += 1) {
    ({targets, skipped} = await sendBridgeCommand<McpCaptureTargetsResult>(
      getMainWindow,
      'get-capture-targets',
      {device}
    ));
    const stillLoading =
      targets.length === 0 && skipped.some((s) => s.reason.includes('still loading'));
    if (!stillLoading || attempt === STILL_LOADING_RETRY_ATTEMPTS) {
      break;
    }
    await sleep(STILL_LOADING_RETRY_DELAY_MS);
  }
  // Without a device filter the bridge returns previews in suite order, so
  // targets[0] is the primary device.
  const target = targets[0];
  if (target === undefined) {
    const reasons = skipped.map((s) => `${s.deviceName}: ${s.reason}`).join('; ');
    throw new Error(
      `No device preview available to interact with${reasons ? ` (${reasons})` : ''}.`
    );
  }
  const targetContents = isRegisteredWebview(target.webContentsId)
    ? webContents.fromId(target.webContentsId)
    : undefined;
  if (targetContents === undefined || targetContents.isDestroyed()) {
    throw new Error(`The ${target.deviceName} preview is no longer available`);
  }
  return {deviceName: target.deviceName, targetContents};
};

const executeInPage = async <T>(
  targetContents: Electron.WebContents,
  script: string
): Promise<T> => {
  return Promise.race([
    targetContents.executeJavaScript(script) as Promise<T>,
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error(`The page did not respond within ${EXECUTE_TIMEOUT_MS}ms`)),
        EXECUTE_TIMEOUT_MS
      );
    }),
  ]);
};

const READ_PAGE_SCRIPT = `
(() => {
  const MAX_ELEMENTS = 100;
  const MAX_TEXT = 3000;
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      if (node.id) {
        parts.unshift('#' + CSS.escape(node.id));
        return parts.join(' > ');
      }
      let selector = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sameTag.length > 1) selector += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
      }
      parts.unshift(selector);
      node = parent;
    }
    return parts.join(' > ');
  };
  const label = (el) =>
    (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')
      .trim()
      .replace(/\\s+/g, ' ')
      .slice(0, 80);
  const candidates = Array.from(
    document.querySelectorAll(
      'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="menuitem"], [onclick]'
    )
  );
  const elements = [];
  for (const el of candidates) {
    if (elements.length >= MAX_ELEMENTS) break;
    if (!isVisible(el)) continue;
    const entry = {selector: cssPath(el), tag: el.tagName.toLowerCase(), text: label(el)};
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      entry.value = String(el.value).slice(0, 80);
      entry.inputType = el.type;
    }
    if (el.disabled) entry.disabled = true;
    if (el.tagName === 'A' && el.href) entry.href = String(el.href).slice(0, 200);
    elements.push(entry);
  }
  const bodyText = (document.body ? document.body.innerText : '')
    .replace(/\\n{3,}/g, '\\n\\n')
    .slice(0, MAX_TEXT);
  const extractSeoFromDocument = ${extractSeoFromDocument.toString()};
  const seo = extractSeoFromDocument(document, location.href);
  return {
    url: location.href,
    title: document.title,
    text: bodyText,
    elements,
    truncatedElements: candidates.length > MAX_ELEMENTS,
    seo,
  };
})()
`;

const locateScript = (selector: string) => `
((selector) => {
  const el = document.querySelector(selector);
  if (!el) return {error: 'No element matches the selector'};
  el.scrollIntoView({block: 'center', inline: 'center'});
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return {error: 'The element is not visible'};
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
  };
})(${JSON.stringify(selector)})
`;

const focusScript = (selector: string | undefined, clear: boolean) => `
((selector, clear) => {
  const el = selector ? document.querySelector(selector) : document.activeElement;
  if (!el || el === document.body) return {error: 'No element matches the selector'};
  el.scrollIntoView({block: 'center', inline: 'center'});
  el.focus();
  if (clear && typeof el.select === 'function') el.select();
  return {ok: true};
})(${JSON.stringify(selector ?? null)}, ${JSON.stringify(clear)})
`;

const readValueScript = (selector: string | undefined) => `
((selector) => {
  const el = selector ? document.querySelector(selector) : document.activeElement;
  if (!el) return {value: ''};
  return {value: String(el.value ?? el.textContent ?? '').slice(0, 200)};
})(${JSON.stringify(selector ?? null)})
`;

interface LocateResult {
  error?: string;
  x: number;
  y: number;
  tag: string;
  text: string;
}

// When a page has JS execution disabled (Emulation.setScriptExecutionDisabled),
// executeJavaScript() — which read_page normally uses — fails outright: the
// script we'd inject to read the page is itself JavaScript. CDP's DOM domain
// still works in that state (it walks the already-parsed render tree, not
// the JS engine), so DOM.getOuterHTML gets us the full markup without
// running anything, and we parse SEO/content out of it the same way the
// raw-HTTP audit does. It's degraded — no live-DOM visibility filtering, no
// real click targets, since nothing on the page can react to a click when
// its handlers never attached — but it means title/meta/canonical/hreflang/
// OG/JSON-LD/alt-text stay inspectable even on a JS-disabled screen.
// A node id from DOM.getDocument is only valid until the next navigation —
// if the guest reloads (a device add/remove cycle, a toggle) between that
// call and DOM.getOuterHTML, CDP rejects the stale id with "Could not find
// node with given id". Re-fetching a fresh id and retrying is cheap and
// always safe, so it's worth a couple of attempts before giving up.
const CDP_STALE_NODE_RETRY_ATTEMPTS = 3;

const readPageViaCdp = async (
  targetContents: Electron.WebContents
): Promise<Omit<ReadPageResult, 'deviceName'>> => {
  const {debugger: dbg} = targetContents;
  const wasAttached = dbg.isAttached();
  if (!wasAttached) {
    dbg.attach();
  }
  try {
    await dbg.sendCommand('DOM.enable');
    let outerHTML: string | undefined;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= CDP_STALE_NODE_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const {root} = await dbg.sendCommand('DOM.getDocument', {depth: -1, pierce: false});
        ({outerHTML} = await dbg.sendCommand('DOM.getOuterHTML', {nodeId: root.nodeId}));
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < CDP_STALE_NODE_RETRY_ATTEMPTS) {
          await sleep(300);
        }
      }
    }
    if (outerHTML === undefined) {
      throw lastErr;
    }
    const {elements, truncated} = parseElements(outerHTML);
    const url = targetContents.getURL();
    const seo = parseSeo(outerHTML, url);
    return {
      url,
      title: extractTitle(outerHTML),
      text: extractBodyText(outerHTML),
      elements,
      truncatedElements: truncated,
      seo,
      report: buildSeoAuditReport(seo),
    };
  } finally {
    // Leave the debugger attached if something else (the JS-disable toggle
    // itself, most likely, since that's the only way this path gets used)
    // already had it attached before we got here — detaching would pull the
    // rug out from under that feature's own CDP session.
    if (!wasAttached) {
      try {
        dbg.detach();
      } catch {
        // Already gone; nothing to clean up.
      }
    }
  }
};

export const readPage = async (
  getMainWindow: GetMainWindow,
  device?: string
): Promise<ReadPageResult> => {
  const {deviceName, targetContents} = await resolveTarget(getMainWindow, device);
  try {
    const page = await executeInPage<Omit<ReadPageResult, 'deviceName' | 'report'>>(
      targetContents,
      READ_PAGE_SCRIPT
    );
    return {deviceName, ...page, report: buildSeoAuditReport(page.seo)};
  } catch {
    // Script execution is the only thing that fails this way for a page
    // that's otherwise loaded and responsive — fall back to the CDP-only
    // path rather than surfacing an error that reads as "nothing to see
    // here" when there's a whole page of SEO markup to report on.
    const page = await readPageViaCdp(targetContents);
    return {deviceName, ...page};
  }
};

export interface ReadAllPagesResult {
  pages: ReadPageResult[];
  skipped: Array<{deviceName: string; reason: string}>;
}

export const readAllPages = async (getMainWindow: GetMainWindow): Promise<ReadAllPagesResult> => {
  const {targets, skipped} = await sendBridgeCommand<McpCaptureTargetsResult>(
    getMainWindow,
    'get-capture-targets',
    {}
  );
  // Each device is read independently (readPage() re-resolves its own target
  // rather than reusing `targets` directly) so one device going away between
  // this listing and its own read — or failing outright — can't take down
  // the rest of the batch; it just moves from `pages` to `skipped`.
  const results = await Promise.allSettled(
    targets.map((target) => readPage(getMainWindow, target.deviceName))
  );
  const pages: ReadPageResult[] = [];
  const allSkipped: Array<{deviceName: string; reason: string}> = [...skipped];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      pages.push(result.value);
    } else {
      allSkipped.push({
        deviceName: targets[index].deviceName,
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });
  return {pages, skipped: allSkipped};
};

export const clickElement = async (
  getMainWindow: GetMainWindow,
  selector: string,
  device?: string
): Promise<ClickResult> => {
  const {deviceName, targetContents} = await resolveTarget(getMainWindow, device);
  const located = await executeInPage<LocateResult>(targetContents, locateScript(selector));
  if (located.error !== undefined) {
    throw new Error(
      `${located.error}: ${selector}. Use the read_page tool to discover clickable elements.`
    );
  }
  const x = Math.round(located.x);
  const y = Math.round(located.y);
  targetContents.sendInputEvent({type: 'mouseMove', x, y});
  targetContents.sendInputEvent({type: 'mouseDown', x, y, button: 'left', clickCount: 1});
  targetContents.sendInputEvent({type: 'mouseUp', x, y, button: 'left', clickCount: 1});
  // Give the page a moment to react (state updates, navigation start).
  await sleep(POST_INPUT_SETTLE_MS);
  return {
    deviceName,
    clicked: {tag: located.tag, text: located.text},
    url: targetContents.getURL(),
    pageTitle: targetContents.getTitle(),
  };
};

const sendCharacter = (targetContents: Electron.WebContents, character: string) => {
  targetContents.sendInputEvent({type: 'keyDown', keyCode: character});
  targetContents.sendInputEvent({type: 'char', keyCode: character});
  targetContents.sendInputEvent({type: 'keyUp', keyCode: character});
};

export const typeText = async (
  getMainWindow: GetMainWindow,
  options: {text: string; selector?: string; clear?: boolean; pressEnter?: boolean; device?: string}
): Promise<TypeTextResult> => {
  const {text, selector, clear = false, pressEnter = false, device} = options;
  const {deviceName, targetContents} = await resolveTarget(getMainWindow, device);
  const focused = await executeInPage<{error?: string}>(
    targetContents,
    focusScript(selector, clear)
  );
  if (focused.error !== undefined) {
    throw new Error(
      `${focused.error}: ${selector}. Use the read_page tool to discover form fields.`
    );
  }
  Array.from(text).forEach((character) => sendCharacter(targetContents, character));
  if (pressEnter) {
    targetContents.sendInputEvent({type: 'keyDown', keyCode: 'Return'});
    targetContents.sendInputEvent({type: 'char', keyCode: 'Return'});
    targetContents.sendInputEvent({type: 'keyUp', keyCode: 'Return'});
  }
  await sleep(POST_INPUT_SETTLE_MS);
  const state = await executeInPage<{value: string}>(targetContents, readValueScript(selector));
  return {
    deviceName,
    value: state.value,
    url: targetContents.getURL(),
    pageTitle: targetContents.getTitle(),
  };
};
