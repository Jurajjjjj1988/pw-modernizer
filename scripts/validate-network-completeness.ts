#!/usr/bin/env tsx
/**
 * validate-network-completeness.ts — fail a Cypress→Playwright migration that
 * SILENTLY DROPS a network stub/assertion, catching a confirmed FALSE-GREEN class.
 *
 * A Cypress source stubs and asserts a network call:
 *   cy.intercept('POST', '/api/checkout/pay').as('payReq');
 *   ...
 *   cy.wait('@payReq').then((i) => { expect(i.response.statusCode).to.equal(201); });
 * Both mainstream codemods (cy2pw, 11joselu) DROP the stub body — verified. The
 * migrated test then either:
 *   - passes against the REAL backend for the wrong reason (the stub that pinned
 *     the response is gone, so the test no longer controls what comes back), or
 *   - for a load-bearing stub, fails as a misleading locator error (a UI state
 *     the stub used to force never appears).
 * Neither produces an EXECUTION error tied to the dropped network call, so no
 * error-text matcher can see it. This is a SOURCE-vs-OUTPUT PRESENCE DIFF: every
 * interception in the Cypress source must be reflected by a fulfilled
 * `page.route(...)` in the migrated tree, and every assertion-on-response must be
 * reflected by a `page.waitForResponse(...)` that reads `response.status()` /
 * `response.json()`.
 *
 *   npx tsx scripts/validate-network-completeness.ts \
 *     --root outputs --input-basename checkout-flow.cy.js \
 *     --source inputs/cypress/checkout-flow.cy.js
 *
 * Pure core (extractSourceIntercepts / findMissingMocks) is unit-tested.
 * Exit 0 = every source intercept is reflected (or the source has no intercept);
 * exit 1 = a stub/assertion was dropped (each is printed).
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { collectEmittedFiles } from "./evaluate.js";
import { findGeneratedSpec } from "./output-spec.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

/** One `cy.intercept(...)` from the Cypress source. */
export interface SourceIntercept {
  /** A matchable URL token — the string/glob path passed to cy.intercept. */
  url: string;
  /** Was it aliased (`.as('x')`)? Only aliased intercepts can be `cy.wait`-ed. */
  aliased: boolean;
  /** Does the test assert on the interception's RESPONSE
   *  (`cy.wait('@x').its('response...')` / `.then(` / `.should('have.property','response...')`)? */
  assertedOn: boolean;
}

/** One dropped stub/assertion the migration must restore. */
export interface MissingMock {
  /** The source intercept URL token that is not reflected in the output. */
  url: string;
  /** Why it was flagged (absent stub / empty body / dropped response-assertion). */
  reason: string;
}

/**
 * The distinctive path segment of a URL/glob token — the part that survives the
 * Cypress-vs-Playwright glob mismatch (Cypress `'/api/cart'` or `'**\/api/cart'`
 * vs Playwright `'**\/api/cart'`). We strip a leading protocol+host, leading
 * `**`/`*`/`/`, a trailing `*`/`**`, and any query string, leaving the bare path
 * (e.g. `api/checkout/pay`). Used to match a source intercept to an output route
 * leniently without demanding byte-identical patterns.
 */
export function distinctivePathSegment(url: string): string {
  let s = url.trim();
  s = s.replace(/^https?:\/\/[^/]+/i, ""); // drop protocol + host
  s = s.split("?")[0] ?? s; // drop query string
  s = s.replace(/^[*/]+/, ""); // drop leading **, *, /
  s = s.replace(/[*]+$/, ""); // drop trailing *, **
  s = s.replace(/\/+$/, ""); // drop trailing slash
  return s.toLowerCase();
}

/**
 * Extract each `cy.intercept(<method?>, <urlOrPattern>, <stub?>)` from a Cypress
 * source: its matchable URL token, whether it is `.as('alias')`-ed, and whether
 * the test asserts on the interception's response. The first STRING-or-regex
 * literal argument that is not an HTTP method is taken as the URL. Aliases are
 * tied back to `cy.wait('@alias')` usages to decide `assertedOn` — an interception
 * is asserted-on when its `cy.wait('@alias')` is chained into `.its('response…')`,
 * `.then(`, or `.should('have.property','response…')`.
 */
export function extractSourceIntercepts(source: string): SourceIntercept[] {
  const out: SourceIntercept[] = [];
  // Match `cy.intercept(` and capture the argument list up to the matching-ish
  // close. Cypress intercept args are simple (no nested parens in the URL/method),
  // so a non-greedy run to the first `)` that is NOT inside the optional stub
  // object is adequate; we then read the optional `.as('alias')` trailing it.
  const re = /cy\.intercept\s*\(([\s\S]*?)\)\s*(?:\.as\(\s*['"`]([^'"`]+)['"`]\s*\))?/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    const args = m[1] ?? "";
    const alias = m[2];
    const url = firstUrlArg(args);
    if (url === null) continue;
    out.push({ url, aliased: alias !== undefined, assertedOn: false });
    if (alias !== undefined) {
      const last = out[out.length - 1];
      if (last) last.assertedOn = waitAssertsOnResponse(source, alias);
    }
  }
  return out;
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** The first argument that is a URL/pattern (skipping a leading HTTP-method
 * string), as its raw token. Handles string literals and RegExp literals. */
function firstUrlArg(args: string): string | null {
  // String-literal args, in order.
  const strRe = /['"`]([^'"`]+)['"`]/g;
  for (let m = strRe.exec(args); m !== null; m = strRe.exec(args)) {
    const val = m[1] ?? "";
    if (HTTP_METHODS.has(val.toUpperCase())) continue; // a leading method, not the URL
    return val;
  }
  // RegExp-literal arg, e.g. cy.intercept(/\/api\/cart/).
  const reArg = /,?\s*\/((?:[^/\\\n]|\\.)+)\/[a-z]*/.exec(args);
  if (reArg?.[1]) return reArg[1].replace(/\\/g, "");
  return null;
}

/**
 * Does the source assert on the RESPONSE of `@alias`? True when a `cy.wait('@alias')`
 * is chained into `.its('response…')`, `.then(`, or `.should('have.property','response…')`.
 * A bare `cy.wait('@alias')` with no such chain only waits — it is NOT an
 * assertion-on-response.
 */
function waitAssertsOnResponse(source: string, alias: string): boolean {
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Capture each cy.wait('@alias') and the chain that immediately follows it,
  // stopping at the statement terminator. The chain may span lines (.then((i) => {).
  const re = new RegExp(String.raw`cy\.wait\(\s*['"\`]@${esc}['"\`]\s*\)([\s\S]{0,200})`, "g");
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    const tail = m[1] ?? "";
    // Stop the tail at the next cy.* call so we don't bleed into a later statement.
    const chain = tail.split(/\bcy\./)[0] ?? tail;
    if (/\.then\s*\(/.test(chain)) return true;
    if (/\.its\s*\(\s*['"`]response/i.test(chain)) return true;
    if (/\.should\s*\(\s*['"`]have\.property['"`]\s*,\s*['"`]response/i.test(chain)) return true;
  }
  return false;
}

/**
 * Diff the source intercepts against the migrated output. For each source
 * intercept the output must contain a `page.route(...<url>...` whose handler has a
 * NON-EMPTY `route.fulfill({...})` body, AND — when the source asserted on the
 * interception's response — a `page.waitForResponse(...<url>...)` that reads
 * `response.status()` / `response.json()`. Flags three drop classes:
 *   - stub entirely absent (no matching page.route),
 *   - stub present but the fulfill body is empty (codemod truncation),
 *   - assertion-on-response dropped (no waitForResponse reading the response).
 */
export function findMissingMocks(intercepts: SourceIntercept[], outputSource: string): MissingMock[] {
  const missing: MissingMock[] = [];
  for (const it of intercepts) {
    const seg = distinctivePathSegment(it.url);
    if (seg === "") continue; // a non-matchable token (e.g. bare '*') — skip
    const route = findRouteForSegment(outputSource, seg);
    if (route === null) {
      missing.push({
        url: it.url,
        reason: `Cypress stubbed ${it.url} but the migrated tree has no page.route() for it — the codemod dropped the stub, so the test runs against the REAL backend (false-green) or fails on a UI state the stub used to force.`,
      });
      continue;
    }
    if (!hasNonEmptyFulfill(route)) {
      missing.push({
        url: it.url,
        reason: `page.route() for ${it.url} is present but has no non-empty route.fulfill({...}) body — the stub payload was truncated, so the route no longer controls the response.`,
      });
    }
    if (it.assertedOn && !assertsOnResponse(outputSource, seg)) {
      missing.push({
        url: it.url,
        reason: `Cypress asserted on the ${it.url} RESPONSE (cy.wait('@…').its/then/should), but the migrated tree has no page.waitForResponse(...) reading response.status()/response.json() for it — the response assertion was dropped.`,
      });
    }
  }
  return missing;
}

/**
 * The `page.route(<pattern>, async (route) => { ... })` block whose pattern
 * contains `seg`, returned as the handler-body source, or null if none matches.
 * Brace-balances the handler so `hasNonEmptyFulfill` sees the whole body.
 */
function findRouteForSegment(output: string, seg: string): string | null {
  const re = /page\.route\s*\(\s*['"`]([^'"`]+)['"`]/g;
  for (let m = re.exec(output); m !== null; m = re.exec(output)) {
    const pattern = m[1] ?? "";
    if (!distinctivePathSegment(pattern).includes(seg) && !seg.includes(distinctivePathSegment(pattern))) {
      continue;
    }
    return output.slice(m.index, balancedBlockEnd(output, m.index));
  }
  return null;
}

/** The index just past the brace-balanced block that opens at/after `start`. */
function balancedBlockEnd(src: string, start: number): number {
  let depth = 0;
  let opened = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") { depth += 1; opened = true; }
    else if (ch === "}") {
      depth -= 1;
      if (opened && depth <= 0) return i + 1;
    }
  }
  return src.length;
}

/** Does this route block fulfill with a NON-EMPTY body? `route.fulfill({ ... })`
 * with at least one property (status/body/json/contentType/…). An empty
 * `route.fulfill()` / `route.fulfill({})` is a truncated stub. */
function hasNonEmptyFulfill(routeBlock: string): boolean {
  const m = /route\.fulfill\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(routeBlock);
  if (!m) return false;
  return (m[1] ?? "").trim().length > 0;
}

/** Does the output `page.waitForResponse(...<seg>...)` read the response
 * (`response.status()` / `response.json()` / `response.body()`)? */
function assertsOnResponse(output: string, seg: string): boolean {
  const re = /page\.waitForResponse\s*\(([\s\S]*?\))\s*\)?/g;
  for (let m = re.exec(output); m !== null; m = re.exec(output)) {
    const head = m[1] ?? "";
    // The matcher arg (URL string/glob or predicate) must reference the segment.
    if (!head.toLowerCase().includes(seg)) continue;
    // Look in a window after the waitForResponse for a response read.
    const window = output.slice(m.index, m.index + 400);
    if (/\bresponse\s*\.\s*(status|json|body|ok)\s*\(/i.test(window)) return true;
  }
  // Fallback: a predicate form `(response) => response.url().includes('seg') && response.status()...`
  const predRe = new RegExp(String.raw`waitForResponse\([\s\S]{0,200}${seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\s\S]{0,200}?response\s*\.\s*(status|json|body|ok)\s*\(`, "i");
  return predRe.test(output);
}

export interface NetworkVerdict {
  /** Did the source contain any cy.intercept at all? */
  hasIntercepts: boolean;
  /** Every source intercept reflected (or no intercepts)? */
  complete: boolean;
  /** The dropped stubs/assertions, if any. */
  missing: MissingMock[];
  /** Human-readable summary. */
  reason: string;
}

/** Combine extract + diff into a single verdict over a source and its emitted
 * tree. Cypress-only: a source with no `cy.intercept` passes trivially. */
export function networkVerdict(source: string, outputSource: string): NetworkVerdict {
  const intercepts = extractSourceIntercepts(source);
  if (intercepts.length === 0) {
    return { hasIntercepts: false, complete: true, missing: [], reason: "source has no cy.intercept — nothing to reflect" };
  }
  const missing = findMissingMocks(intercepts, outputSource);
  return {
    hasIntercepts: true,
    complete: missing.length === 0,
    missing,
    reason: missing.length === 0
      ? `all ${intercepts.length} source intercept(s) are reflected by a fulfilled page.route (+ response assertions where asserted)`
      : `${missing.length} dropped stub/assertion(s) of ${intercepts.length} source intercept(s)`,
  };
}

function main(): number {
  const { values } = parseArgs({
    options: {
      root: { type: "string", default: "outputs" },
      "input-basename": { type: "string" },
      source: { type: "string" },
    },
    strict: true,
  });
  const base = values["input-basename"];
  const sourcePath = values.source;
  if (!base) { process.stderr.write("validate-network-completeness: --input-basename <base> required.\n"); return 1; }
  if (!sourcePath) { process.stderr.write("validate-network-completeness: --source <legacy-cypress-test> required.\n"); return 1; }
  if (!existsSync(sourcePath)) {
    process.stderr.write(`validate-network-completeness: --source not found at ${sourcePath}.\n`);
    return 1;
  }
  const source = readFileSync(sourcePath, "utf8");
  // Only Cypress sources can carry cy.intercept — pass trivially otherwise.
  if (!/cy\.intercept\s*\(/.test(source)) {
    process.stdout.write(`network completeness ✓ — source has no cy.intercept (nothing to reflect).\n`);
    return 0;
  }
  const outDir = resolve(REPO_ROOT, values.root ?? "outputs", "tests");
  const spec = findGeneratedSpec(outDir, base);
  if (!spec) {
    process.stderr.write(`validate-network-completeness: no spec for ${base} under ${relative(REPO_ROOT, outDir)}.\n`);
    return 1;
  }
  const files = collectEmittedFiles(spec).filter(existsSync);
  const outputSource = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const v = networkVerdict(source, outputSource);
  if (v.complete) {
    process.stdout.write(`network completeness ✓ — ${v.reason} (${files.length} emitted files).\n`);
    return 0;
  }
  process.stderr.write(`network completeness ✗ — ${v.reason}:\n`);
  for (const miss of v.missing) {
    process.stderr.write(`  - ${miss.reason}\n`);
  }
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
