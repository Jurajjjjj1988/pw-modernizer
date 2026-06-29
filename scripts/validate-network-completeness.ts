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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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
  /**
   * Is this a STUB (the intercept supplies a response) rather than a SPY
   * (passthrough — it only observes the real call)? True only when `cy.intercept`
   * carries a 3rd-arg STUB: a response object literal, a `{ fixture: '…' }`, OR a
   * `req.reply(...)` inside a routeHandler callback. A 2-arg `cy.intercept(method, url)`
   * (or `cy.intercept(url)`) is a SPY — it must be reflected by a SYNC POINT
   * (`page.waitForResponse`), not a fulfilled `page.route`. Conflating the two made
   * the validator demand a fabricated `route.fulfill` for spy-only observations.
   */
  hasStub: boolean;
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
    out.push({ url, aliased: alias !== undefined, assertedOn: false, hasStub: interceptHasStub(source, m.index) });
    if (alias !== undefined) {
      const last = out[out.length - 1];
      if (last) last.assertedOn = waitAssertsOnResponse(source, alias);
    }
  }
  return out;
}

/**
 * Is this `cy.intercept(...)` a STUB (it supplies the response) vs a SPY
 * (passthrough — it only observes the real call)? The non-greedy arg capture
 * truncates a stub body that itself contains `)` (e.g. `JSON.stringify(...)`) or a
 * `req.reply(...)` callback, so we read a bounded WINDOW from the `cy.intercept(`
 * start (sized to the PAREN-balanced call so a spy with no braces does not bleed
 * forward) and look for the stub forms:
 *   - a 3rd-arg RESPONSE OBJECT LITERAL: a `{ … }` after the URL/method args
 *     carrying a stub key (statusCode/status/body/headers/statusMessage/
 *     forceNetworkError/delay),
 *   - a FIXTURE stub: `{ fixture: '…' }`,
 *   - a routeHandler that calls `req.reply(...)`.
 * A bare 2-arg `cy.intercept(method, url)` / `cy.intercept(url)` is a SPY.
 */
function interceptHasStub(source: string, startIdx: number): boolean {
  // Read only THIS `cy.intercept(...)` call (paren-balanced) so a spy with no
  // braces does not bleed into a later statement's stub, while a stub body the
  // lazy arg-capture truncated (`JSON.stringify(...)`, a `req.reply` callback) is
  // still fully seen.
  const callOpen = source.indexOf("(", startIdx);
  if (callOpen === -1) return false;
  const window = source.slice(startIdx, parenBalancedEnd(source, callOpen));
  if (/\breq\s*\.\s*reply\s*\(/.test(window)) return true; // routeHandler stub
  // Strip string-literal CONTENTS (the URL/method args, any quoted header values)
  // so a `{` or stub keyword inside a quoted string never reads as a stub object.
  const stripped = window.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
  // A response object literal / fixture stub carries one of these stub keys.
  return /\{[\s\S]*\b(statusCode|status|body|headers|statusMessage|forceNetworkError|delay|fixture)\b[\s\S]*\}/.test(stripped);
}

/** The index just past the paren-balanced run that OPENS at `open` (which must
 * point at a `(`). String/template literal contents are skipped so a `)` inside a
 * quoted URL does not close the call early. Falls back to EOF if unbalanced. */
function parenBalancedEnd(src: string, open: number): number {
  // Neutralise string/template literal contents first so quoted parens/escapes
  // never count toward depth — then a flat paren scan is correct and shallow.
  const flat = src.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (lit) => " ".repeat(lit.length));
  let depth = 0;
  for (let i = open; i < flat.length; i++) {
    if (flat[i] === "(") depth += 1;
    else if (flat[i] === ")" && --depth <= 0) return i + 1;
  }
  return src.length;
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
 * OR a `cy.get('@alias')` (the alias-YIELD form) is chained — within a bounded
 * window — into `.its('response…')`, `.then(`, or `.should('have.property','response…')`.
 * A bare `cy.wait('@alias')` / `cy.get('@alias')` with no such chain only
 * waits/yields — it is NOT an assertion-on-response. Covering `cy.get('@alias')`
 * catches the pattern where a test yields the interception alias to read its
 * response (`cy.get('@pay').its('response.statusCode')`), which the cy.wait-only
 * scan missed.
 */
function waitAssertsOnResponse(source: string, alias: string): boolean {
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Both `cy.wait('@alias')` and `cy.get('@alias')` can be chained into a
  // response read; scan each occurrence's trailing chain. The tail is a LOOKAHEAD
  // so a later `cy.wait/get('@alias')` is not swallowed by an earlier match's
  // window (e.g. a bare `cy.wait('@x')` followed by `cy.get('@x').its(...)`).
  const re = new RegExp(String.raw`cy\.(?:wait|get)\(\s*['"\`]@${esc}['"\`]\s*\)(?=([\s\S]{0,200}))`, "g");
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    const tail = m[1] ?? "";
    // Stop the tail at the next cy.* call so we don't bleed into a later statement.
    const chain = tail.split(/\bcy\./)[0] ?? tail;
    if (chainReadsResponse(chain)) return true;
  }
  return false;
}

/** A trailing chain that reads the interception's response: `.then(` (yields the
 * interception), `.its('response…')`, or `.should('have.property','response…')`. */
function chainReadsResponse(chain: string): boolean {
  if (/\.then\s*\(/.test(chain)) return true;
  if (/\.its\s*\(\s*['"`]response/i.test(chain)) return true;
  return /\.should\s*\(\s*['"`]have\.property['"`]\s*,\s*['"`]response/i.test(chain);
}

/**
 * Diff the source intercepts against the migrated output. The required reflection
 * depends on whether the source intercept is a STUB or a SPY:
 *   - STUB (`hasStub`: response object / `{fixture}` / `req.reply`): the output must
 *     contain a `page.route(...<url>...)` whose handler has a NON-EMPTY
 *     `route.fulfill({...})` body (an absent route or empty fulfill is flagged) —
 *     a dropped stub makes the test run against the REAL backend (false-green).
 *   - SPY (passthrough — only observes the real call): demanding a fabricated
 *     `page.route`/`fulfill` would be WRONG (it would invent a mock the source never
 *     had). Instead the output must contain a `page.waitForResponse(...<url>...)`
 *     SYNC POINT — without it the migrated test loses the wait the spy provided.
 * On top of either, when the source asserted on the interception's RESPONSE the
 * output must also have a `page.waitForResponse(...)` that READS the response
 * (`response.status()` / `response.json()`); a dropped read is flagged.
 */
export function findMissingMocks(intercepts: SourceIntercept[], outputSource: string): MissingMock[] {
  const missing: MissingMock[] = [];
  for (const it of intercepts) {
    const seg = distinctivePathSegment(it.url);
    if (seg === "") continue; // a non-matchable token (e.g. bare '*') — skip
    if (it.hasStub) checkStubReflection(it, seg, outputSource, missing);
    else checkSpyReflection(it, seg, outputSource, missing);
    checkResponseAssertion(it, seg, outputSource, missing);
  }
  return missing;
}

/** A STUB must be reflected by a fulfilled `page.route(...)` — flag an absent
 * route or an empty-body fulfill. */
function checkStubReflection(it: SourceIntercept, seg: string, output: string, missing: MissingMock[]): void {
  const route = findRouteForSegment(output, seg);
  if (route === null) {
    missing.push({
      url: it.url,
      reason: `Cypress stubbed ${it.url} but the migrated tree has no page.route() for it — the codemod dropped the stub, so the test runs against the REAL backend (false-green) or fails on a UI state the stub used to force.`,
    });
    return;
  }
  if (!hasNonEmptyFulfill(route)) {
    missing.push({
      url: it.url,
      reason: `page.route() for ${it.url} is present but has no non-empty route.fulfill({...}) body — the stub payload was truncated, so the route no longer controls the response.`,
    });
  }
}

/** A SPY (passthrough) the source CONSUMED (aliased → `cy.wait`/`cy.get`-able) must
 * be reflected by a `page.waitForResponse(...<seg>...)` sync point — a fulfilled
 * route would fabricate a mock the source never had. An UNALIASED spy was never
 * waited/asserted (nothing to synchronise on), so there is nothing to preserve and
 * it is not flagged — flagging it would be a false positive. */
function checkSpyReflection(it: SourceIntercept, seg: string, output: string, missing: MissingMock[]): void {
  if (!it.aliased) return; // a passive, never-waited spy — no sync point to keep
  if (waitsForResponseOnSegment(output, seg)) return;
  // A fulfilled page.route on the same segment also satisfies the sync point
  // (the migration chose to stub a spy — stronger, not a drop).
  if (findRouteForSegment(output, seg) !== null) return;
  missing.push({
    url: it.url,
    reason: `Cypress spied on ${it.url} (a 2-arg cy.intercept, no stub body) and waited on it, but the migrated tree has no page.waitForResponse(...) sync point for it — the wait the spy provided was dropped, so the test no longer synchronises on that call.`,
  });
}

/** When the source asserted on the RESPONSE, the output must read it via a
 * `page.waitForResponse(...)` that calls `response.status()`/`.json()`/… */
function checkResponseAssertion(it: SourceIntercept, seg: string, output: string, missing: MissingMock[]): void {
  if (!it.assertedOn || assertsOnResponse(output, seg)) return;
  missing.push({
    url: it.url,
    reason: `Cypress asserted on the ${it.url} RESPONSE (cy.wait/get('@…').its/then/should), but the migrated tree has no page.waitForResponse(...) reading response.status()/response.json() for it — the response assertion was dropped.`,
  });
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

/** Is there a `page.waitForResponse(...)` whose matcher arg references `seg`
 * (a string/glob URL or a `(response) => response.url().includes('seg')`
 * predicate)? This is the SYNC POINT a spy/passthrough intercept must keep — it
 * does NOT require the response to be read (that is `assertsOnResponse`). */
function waitsForResponseOnSegment(output: string, seg: string): boolean {
  const re = /page\.waitForResponse\s*\(([\s\S]*?\))\s*\)?/g;
  for (let m = re.exec(output); m !== null; m = re.exec(output)) {
    if ((m[1] ?? "").toLowerCase().includes(seg)) return true;
  }
  return false;
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
      ? `all ${intercepts.length} source intercept(s) are reflected (stubs by a fulfilled page.route, spies by a page.waitForResponse sync point; + response assertions where asserted)`
      : `${missing.length} dropped stub/assertion(s) of ${intercepts.length} source intercept(s)`,
  };
}

/**
 * The `.ts` files under `helper/fixtures/` and `helper/actions/` of an emitted
 * tree (recursively). A route stub is frequently parked in a mock FIXTURE
 * (`products-mocks.fixture.ts` calls `page.route(...).fulfill(...)` in a worker
 * fixture) or an ACTION helper, NOT imported by the spec through an `@alias` the
 * import-following walk can see — so `collectEmittedFiles` (import + fixture-
 * injection + stem-fallback) misses it and the validator falsely flags the stub
 * as dropped. This DIRECTORY scan augments the file set so such stubs are seen.
 * It is a local augmentation — `collectEmittedFiles` is left untouched.
 */
export function collectFixtureAndActionFiles(helperRoot: string): string[] {
  const out: string[] = [];
  for (const sub of ["fixtures", "actions"]) {
    const dir = join(helperRoot, sub);
    if (!existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined) break;
      for (const entry of readdirSync(cur, { withFileTypes: true })) {
        const full = join(cur, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "_legacy-v0.1.x") stack.push(full);
        } else if (entry.name.endsWith(".ts")) {
          out.push(full);
        }
      }
    }
  }
  return out;
}

/**
 * Every emitted file whose source the network diff must read: the import/fixture-
 * reachable tree (`collectEmittedFiles`, untouched) UNIONed with the mock-fixture /
 * action directory scan so a route stub parked in `helper/fixtures/*-mocks.fixture.ts`
 * is seen even when the spec never imports it through an `@alias`. Deduped, existing
 * files only. `helperRoot` is derived from `--root` so calibration fixtures resolve
 * their own `helper/` tree.
 */
function collectOutputFiles(spec: string, rootDir: string): string[] {
  const helperRoot = join(rootDir, "helper");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [...collectEmittedFiles(spec, helperRoot), ...collectFixtureAndActionFiles(helperRoot)]) {
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    out.push(f);
  }
  return out;
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
  const rootDir = resolve(REPO_ROOT, values.root ?? "outputs");
  const outDir = join(rootDir, "tests");
  const spec = findGeneratedSpec(outDir, base);
  if (!spec) {
    process.stderr.write(`validate-network-completeness: no spec for ${base} under ${relative(REPO_ROOT, outDir)}.\n`);
    return 1;
  }
  const files = collectOutputFiles(spec, rootDir);
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
