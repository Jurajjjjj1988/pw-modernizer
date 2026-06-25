/**
 * nav-urls.ts — derive the pages a test actually navigates to (IMP1).
 *
 * The DOM-grounding snapshot was captured at the bare MIGRATION_TARGET_URL (the
 * site root). But a test navigates DEEPER — `cy.visit('/login')`,
 * `page.goto('/cart')`, `driver.get(".../inventory")` — so the snapshot showed
 * the homepage, not the form the test interacts with, and the LLM had to GUESS
 * the login locators (then the repair loop fixed them). Capturing a snapshot of
 * the ACTUAL pages lets grounding verify those locators first-try, cutting repair
 * rounds. This extracts the navigation targets from the source test across
 * frameworks and resolves them against the base URL.
 */

/** Extract distinct navigation URLs from a source test, resolved against baseUrl. */
export function deriveNavUrls(source: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  // cy.visit('x') | page.goto('x') | driver.get("x") | await page.goto(`x`)
  const re = /(?:cy\.visit|\.goto|driver\.get)\s*\(\s*(['"`])([^'"`]+)\1/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    const raw = (m[2] ?? "").trim();
    if (raw.length === 0 || raw.startsWith("${") || raw.includes("${")) continue; // skip templated URLs
    const resolved = resolveUrl(raw, baseUrl);
    if (resolved && !seen.has(resolved)) { seen.add(resolved); urls.push(resolved); }
  }
  return urls;
}

function resolveUrl(raw: string, baseUrl: string): string | null {
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).toString();
    if (baseUrl.length === 0) return null;
    return new URL(raw, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}

/**
 * Build a dom-snapshot `--flow` spec that visits + snapshots each page, so a
 * single capture covers every page the test touches. Returns "" when there are
 * no derivable URLs (caller falls back to `--url baseUrl`).
 */
export function buildSnapshotFlow(urls: string[]): string {
  if (urls.length === 0) return "";
  return urls.map((u, i) => `goto ${u}; snap page${i + 1}`).join("; ");
}
