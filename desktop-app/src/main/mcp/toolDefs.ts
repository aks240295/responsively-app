import {z} from 'zod';

/**
 * Pure tool metadata (descriptions + zod input shapes) shared by the live
 * server (tools.ts) and the manifest build script that runs OUTSIDE Electron
 * (.erb/scripts/generate-mcp-manifest.ts). This module must only ever import
 * zod — never electron or anything that does.
 */
export const toolDefs = {
  get_app_state: {
    description:
      'Get the current state of Responsively App: the URL loaded in the device previews, ' +
      'the page title, preview layout, zoom factor, and the active devices with their dimensions.',
  },
  navigate: {
    description:
      'Navigate all Responsively App device previews to a URL. Accepts http(s) and file:// ' +
      'URLs; bare domains get https:// prepended (localhost gets http://). Waits for the page ' +
      'to finish loading (up to 30s) before returning the final URL and page title.',
    inputSchema: {url: z.string().min(1).describe('The URL to load in every device preview')},
  },
  list_devices: {
    description:
      'List every device available in Responsively App (phones, tablets, laptops, desktops ' +
      'and user-defined custom devices). Returns id, name, dimensions, type, and whether each ' +
      'device is currently active in the preview.',
  },
  set_active_devices: {
    description:
      'Replace the set of device previews shown in Responsively App. Accepts device ids or ' +
      'exact device names (use list_devices to discover them). Every preview loads the ' +
      'current URL.',
    inputSchema: {
      devices: z
        .array(z.string())
        .min(1)
        .describe('Device ids or exact device names to show, e.g. ["10008", "iPad Pro"]'),
    },
  },
  read_page: {
    description:
      'Read the page rendered in a Responsively App device preview: the page text plus its ' +
      'interactive elements (links, buttons, form fields) with CSS selectors usable with the ' +
      'click and type_text tools, and the SEO audit (raw seo fields plus a report of ' +
      'findings/severity counts). Defaults to the primary (first) device preview. See ' +
      "read_all_pages's description for the recommended column layout when exporting results " +
      'across many pages/devices as a flat table (CSV).',
    inputSchema: {
      device: z
        .string()
        .optional()
        .describe('Optional device id or exact name; omit to read the primary device'),
    },
  },
  read_all_pages: {
    description:
      'Read every currently active Responsively App device preview at once — the same data ' +
      'read_page returns (page text, interactive elements, and the full SEO audit: raw seo ' +
      'fields plus report findings/severity counts) for each active device in one call, so an ' +
      'N-device preview set (JS-enabled, JS-disabled, network-blocked, different viewports, ' +
      "etc.) doesn't need one read_page call per device. Takes no arguments — reads whatever " +
      'is currently active. A device that could not be read (e.g. its preview just closed) is ' +
      'listed under "skipped" with a reason instead of failing the whole call.\n\n' +
      'Recommended raw/CSV export layout: when asked to export results across many pages and ' +
      'devices as a flat table (e.g. a CSV to open in a spreadsheet), use one row per ' +
      '(page, device) pair with these columns, in this order: Page, Device, NavOk, Success, ' +
      'Error, Url, TextLen, Title, TitleCount, MetaDescLen, MetaDescCount, Canonical, ' +
      'CanonicalCount, CanonicalIsRelative, CanonicalHasFragment, HreflangCount, ' +
      'HreflangHasSelf, OgComplete, TwitterCard, JsonLdTypes (semicolon-joined), ' +
      'JsonLdParseErrors, H1Count, H2Count, H1SameAsTitle, RobotsMeta, RobotsNoindex, ' +
      'RobotsNofollow, ViewportSet, ImgTotal, ImgMissingAlt, ImgEmptyAlt, ImgAltOver100Chars, ' +
      'EmptyAnchorTextCount, UrlHasNonAscii, UrlHasUppercase, UrlHasTrackingParams, ' +
      'IframeCount, IframeExternalDomains (semicolon-joined hostnames), ' +
      'CriticalCount, WarningCount, OpportunityCount, FindingIds (semicolon-joined report ' +
      'finding ids). Page/Device/NavOk/Success/Error/Url/TextLen come from the call context ' +
      'and the page/text/url fields; every other column is the seo field or report count of ' +
      "the same name. Note: an external-domain iframe's own content (a casino widget, a " +
      'sportsbook embed, etc.) is never read into any of these fields — only that such an ' +
      'iframe exists is reported (IframeCount/IframeExternalDomains and the ' +
      'iframe-external-content finding).',
  },
  click: {
    description:
      'Click an element in a Responsively App device preview using a real (trusted) mouse ' +
      'event at the element center; the element is scrolled into view first. With event ' +
      'mirroring enabled (the app default), the click replicates across all device previews. ' +
      'Use read_page to discover selectors. Returns the URL and title after the click.',
    inputSchema: {
      selector: z.string().min(1).describe('CSS selector of the element to click'),
      device: z
        .string()
        .optional()
        .describe('Optional device id or exact name; omit to click in the primary device'),
    },
  },
  type_text: {
    description:
      'Type text into a form field in a Responsively App device preview using real ' +
      'keystrokes. Focuses the element first (or uses the currently focused element when no ' +
      'selector is given). Returns the field value plus URL and title after typing.',
    inputSchema: {
      text: z.string().describe('The text to type'),
      selector: z
        .string()
        .optional()
        .describe('CSS selector of the field; omit to type into the focused element'),
      clear: z
        .boolean()
        .optional()
        .describe('Select the existing field content first so typing replaces it'),
      pressEnter: z.boolean().optional().describe('Press Enter after typing (submits forms)'),
      device: z
        .string()
        .optional()
        .describe('Optional device id or exact name; omit to type in the primary device'),
    },
  },
  set_javascript_enabled: {
    description:
      'Enable or disable JavaScript execution for one Responsively App device preview. ' +
      'Reloads that preview so the change takes effect; the state persists across further ' +
      'reloads and navigation until changed again or the device is removed from the preview.',
    inputSchema: {
      device: z.string().min(1).describe('Device id or exact name (use list_devices)'),
      enabled: z.boolean().describe('true to enable JavaScript, false to disable it'),
    },
  },
  set_network_scripts_blocked: {
    description:
      'Block or unblock JavaScript network requests for one Responsively App device preview, ' +
      'without disabling the JavaScript engine itself. Distinct from set_javascript_enabled: ' +
      'the page can still execute inline or already-loaded scripts, but any request Chromium ' +
      'classifies as a script (any <script src>, any source) is cancelled at the network layer ' +
      '— closer to an ad-blocker, corporate firewall, or a dead CDN than a no-JS browser. ' +
      'Reloads that preview so the change takes effect; the state persists across further ' +
      'reloads and navigation until changed again or the device is removed from the preview.',
    inputSchema: {
      device: z.string().min(1).describe('Device id or exact name (use list_devices)'),
      blocked: z.boolean().describe('true to block script network requests, false to allow them'),
    },
  },
  screenshot: {
    description:
      'Capture screenshots of Responsively App device previews rendering the current page. ' +
      'Returns one labeled JPEG per active device, or a single device if specified by id or ' +
      'name. Screenshots show the visible viewport and are downscaled to at most 1000px wide.',
    inputSchema: {
      device: z
        .string()
        .optional()
        .describe('Optional device id or exact name; omit to capture all active devices'),
    },
  },
};

export type ToolName = keyof typeof toolDefs;
