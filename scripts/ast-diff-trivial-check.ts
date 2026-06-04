#!/usr/bin/env node
/**
 * ast-diff-trivial-check.ts — rejects "fake" migrations where the LLM only
 * renamed identifiers (Type-2 clones per Roy/Cordy NiCad, Jiang/Misherghi
 * Deckard taxonomy).
 *
 * Routing (by input extension):
 *   .ts / .tsx / .js / .jsx -> ts-morph + Zhang-Shasha    [ts-morph]
 *   .java                   -> tree-sitter-java + Zhang-Shasha [tree-sitter-java]
 *   .py                     -> tree-sitter-python + Zhang-Shasha [tree-sitter-python]
 *   anything else           -> legacy LCS string overlap  [fallback LCS]
 *
 * Output (the LLM's emitted spec) is always TS by contract, so ts-morph
 * always handles the output side. Comparing trees across languages is fine
 * here because we only care about whether the *structure* changed under
 * identifier erasure — both sides are normalised to `$id`/`$str`/`$num`
 * labels plus a syntax-kind string.
 *
 * Normalisation:
 *   - identifier-like nodes      -> "$id"
 *   - string/char-literal nodes  -> "$str"
 *   - numeric-literal nodes      -> "$num"
 *   - everything else            -> the parser's node-kind name
 * That kills cosmetic renames (Type-2 clones collapse to identical trees).
 *
 * Threshold: reject if normalized tree-edit distance < 5% of max(|T1|,|T2|).
 * Same threshold across languages today — future tuning may differ per
 * language; the per-language label spaces are slightly different.
 *
 * Exit codes:
 *   0 = output is substantively different (good)
 *   1 = output is a rename-only / cosmetic rewrite (bad — reject migration)
 */

import { readFileSync, statSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { Project, Node, SyntaxKind, ts } from "ts-morph";

// tree-sitter ships as a CommonJS native module; require() under ESM via
// createRequire keeps the import side-effect-free and dodges the "default
// vs namespace export" interop trap for native bindings.
const require = createRequire(import.meta.url);

interface Args {
  input: string;
  output: string;
  threshold?: string;
}

interface NormalizedNode {
  label: string;
  children: NormalizedNode[];
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      output: { type: "string" },
      threshold: { type: "string" },
    },
  });
  for (const k of ["input", "output"] as const) {
    if (!values[k]) {
      throw new Error(`--${k} is required`);
    }
  }
  return values as unknown as Args;
}

/**
 * Resolve a possibly-directory path to an actual source file. Mirrors the
 * generator behaviour where a "unit" may be a directory of files.
 */
function resolveSourceFile(p: string, preferSpec: boolean): string {
  let st;
  try {
    st = statSync(p);
  } catch {
    // Path doesn't exist. If it looks like a file (has extension), try a
    // stem-match search in the parent directory — covers cross-language
    // migrations where input `Foo.java` translates to output `Foo.spec.ts`
    // and migrate.yml passes the literal source basename as --output.
    const parent = dirname(p);
    const stem = basename(p).replace(/\.[^.]+$/, "");
    try {
      const siblings = readdirSync(parent, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name);
      // Prefer .spec.ts/.spec.tsx (Stage 2 output convention) then any file
      // sharing the stem.
      if (preferSpec) {
        const spec = siblings.find((n) => n === `${stem}.spec.ts` || n === `${stem}.spec.tsx`);
        if (spec) return join(parent, spec);
      }
      const stemHit = siblings.find((n) => n.startsWith(`${stem}.`));
      if (stemHit) return join(parent, stemHit);
    } catch {
      // Parent doesn't exist either — fall through to return original path
      // so downstream readFileSync emits a clear ENOENT.
    }
    return p;
  }
  if (!st.isDirectory()) return p;
  const exts = [".ts", ".tsx", ".js", ".jsx", ".java", ".py"];
  const entries = readdirSync(p, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  if (preferSpec) {
    const spec = entries.find((n) => /\.spec\.(ts|tsx|js|jsx)$/.test(n));
    if (spec) return join(p, spec);
  }
  for (const ext of exts) {
    const hit = entries.find((n) => n.toLowerCase().endsWith(ext));
    if (hit) return join(p, hit);
  }
  if (entries.length > 0) return join(p, entries[0]!);
  return p;
}

/* ---------------- ts-morph normalisation (TS/JS) ---------------- */

const NORM_LABEL: ReadonlyMap<SyntaxKind, string> = new Map([
  [SyntaxKind.Identifier, "$id"],
  [SyntaxKind.PrivateIdentifier, "$id"],
  [SyntaxKind.StringLiteral, "$str"],
  [SyntaxKind.NoSubstitutionTemplateLiteral, "$str"],
  [SyntaxKind.TemplateHead, "$str"],
  [SyntaxKind.TemplateMiddle, "$str"],
  [SyntaxKind.TemplateTail, "$str"],
  [SyntaxKind.NumericLiteral, "$num"],
  [SyntaxKind.BigIntLiteral, "$bigint"],
  [SyntaxKind.RegularExpressionLiteral, "$regex"],
]);

function buildNormalizedTreeTs(node: Node): NormalizedNode {
  const kind = node.getKind();
  const label = NORM_LABEL.get(kind) ?? SyntaxKind[kind] ?? String(kind);
  const children: NormalizedNode[] = [];
  node.forEachChild((child: Node) => {
    children.push(buildNormalizedTreeTs(child));
  });
  return { label, children };
}

/* ---------------- tree-sitter normalisation (Java / Python) ---------------- */

// Minimal structural typing for the tree-sitter SyntaxNode subset we need.
// Avoids `any` while staying decoupled from the CJS module's full surface.
interface TsSyntaxNode {
  type: string;
  isNamed: boolean;
  namedChildren: TsSyntaxNode[];
}
interface TsTree {
  rootNode: TsSyntaxNode;
}
interface TsParser {
  setLanguage(lang: unknown): void;
  parse(src: string): TsTree;
}
type TsParserCtor = new () => TsParser;

// Tree-sitter node-kind names we normalise. Lists are the *grammar* names
// from tree-sitter-java and tree-sitter-python — kept narrow so we only erase
// what's safe to erase (avoid collapsing structural kinds by accident).
const TS_IDENTIFIER_KINDS = new Set<string>([
  "identifier",
  "type_identifier",
  "field_identifier",
  "scoped_identifier",
  "scoped_type_identifier",
  "simple_identifier",
  "dotted_name",
]);
const TS_STRING_KINDS = new Set<string>([
  "string_literal",
  "character_literal",
  "string",
  "string_fragment",
  "string_content",
  "escape_sequence",
  "interpolation",
  "concatenated_string",
]);
const TS_NUMBER_KINDS = new Set<string>([
  "decimal_integer_literal",
  "hex_integer_literal",
  "octal_integer_literal",
  "binary_integer_literal",
  "decimal_floating_point_literal",
  "hex_floating_point_literal",
  "integer",
  "float",
]);

function normaliseTreeSitterLabel(kind: string): string {
  if (TS_IDENTIFIER_KINDS.has(kind)) return "$id";
  if (TS_STRING_KINDS.has(kind)) return "$str";
  if (TS_NUMBER_KINDS.has(kind)) return "$num";
  return kind;
}

function buildNormalizedTreeFromTs(node: TsSyntaxNode): NormalizedNode {
  const label = normaliseTreeSitterLabel(node.type);
  const children: NormalizedNode[] = [];
  for (const c of node.namedChildren) {
    children.push(buildNormalizedTreeFromTs(c));
  }
  return { label, children };
}

type Lang = "java" | "python";

function parseWithTreeSitter(src: string, lang: Lang): NormalizedNode | null {
  try {
    const ParserMod = require("tree-sitter") as TsParserCtor;
    const grammarPkg = lang === "java" ? "tree-sitter-java" : "tree-sitter-python";
    const grammar = require(grammarPkg) as unknown;
    const parser = new ParserMod();
    parser.setLanguage(grammar);
    const tree = parser.parse(src);
    return buildNormalizedTreeFromTs(tree.rootNode);
  } catch (err) {
    process.stderr.write(
      `::warning::tree-sitter parse for ${lang} failed: ${(err as Error).message}\n`,
    );
    return null;
  }
}

/* ---------------- Tree-edit distance (Zhang-Shasha) ---------------- */

function countNodes(t: NormalizedNode): number {
  let n = 1;
  for (const c of t.children) n += countNodes(c);
  return n;
}

interface TedCtx {
  f1: Flattened;
  f2: Flattened;
  td: number[][];
}

function fillForestDist(ctx: TedCtx, i: number, j: number): void {
  const { f1, f2, td } = ctx;
  const li = f1.lLeaf[i]!;
  const lj = f2.lLeaf[j]!;
  const sizeI = i - li + 2;
  const sizeJ = j - lj + 2;
  const fd: number[][] = Array.from({ length: sizeI }, () =>
    new Array<number>(sizeJ).fill(0),
  );
  for (let i1 = 1; i1 < sizeI; i1 += 1) fd[i1]![0] = fd[i1 - 1]![0]! + 1;
  for (let j1 = 1; j1 < sizeJ; j1 += 1) fd[0]![j1] = fd[0]![j1 - 1]! + 1;
  for (let i1 = 1; i1 < sizeI; i1 += 1) {
    for (let j1 = 1; j1 < sizeJ; j1 += 1) {
      const ai = li + i1 - 1;
      const aj = lj + j1 - 1;
      const delPath = fd[i1 - 1]![j1]! + 1;
      const insPath = fd[i1]![j1 - 1]! + 1;
      const bothLeaf = f1.lLeaf[ai] === li && f2.lLeaf[aj] === lj;
      if (bothLeaf) {
        const cost = f1.labels[ai] === f2.labels[aj] ? 0 : 1;
        const matchPath = fd[i1 - 1]![j1 - 1]! + cost;
        fd[i1]![j1] = Math.min(delPath, insPath, matchPath);
        td[ai]![aj] = fd[i1]![j1]!;
      } else {
        const li1 = f1.lLeaf[ai]! - li;
        const lj1 = f2.lLeaf[aj]! - lj;
        const subPath = fd[li1]![lj1]! + td[ai]![aj]!;
        fd[i1]![j1] = Math.min(delPath, insPath, subPath);
      }
    }
  }
}

/**
 * Zhang-Shasha tree edit distance (Zhang & Shasha 1989). APTED (Pawlik &
 * Augsten 2015/2016) is an optimised variant with the same recurrence; on
 * the < ~3000-node trees produced by a single test file the two are
 * indistinguishable in wall-clock terms.
 */
function treeEditDistance(t1: NormalizedNode, t2: NormalizedNode): number {
  const f1 = flatten(t1);
  const f2 = flatten(t2);
  const n = f1.labels.length;
  const m = f2.labels.length;
  const td: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  const ctx: TedCtx = { f1, f2, td };
  const keyroots1 = computeKeyroots(f1.lLeaf);
  const keyroots2 = computeKeyroots(f2.lLeaf);
  for (const i of keyroots1) {
    for (const j of keyroots2) {
      fillForestDist(ctx, i, j);
    }
  }
  return td[n - 1]![m - 1]!;
}

interface Flattened {
  labels: string[];
  lLeaf: number[];
}

function flatten(t: NormalizedNode): Flattened {
  const labels: string[] = [];
  const lLeaf: number[] = [];
  function visit(node: NormalizedNode): number {
    // Returns the postorder index of node.
    let leftmost = -1;
    for (let i = 0; i < node.children.length; i += 1) {
      const childLeft = visit(node.children[i]!);
      if (i === 0) leftmost = childLeft;
    }
    const idx = labels.length;
    labels.push(node.label);
    lLeaf.push(leftmost === -1 ? idx : leftmost);
    return leftmost === -1 ? idx : leftmost;
  }
  visit(t);
  return { labels, lLeaf };
}

function computeKeyroots(lLeaf: number[]): number[] {
  const seen = new Map<number, number>();
  for (let i = 0; i < lLeaf.length; i += 1) {
    seen.set(lLeaf[i]!, i);
  }
  return [...seen.values()].sort((a, b) => a - b);
}

/**
 * Cheap fallback for ASTs too large for Zhang-Shasha. Multiset distance over
 * (label, child-count) pairs — symmetric difference normalised by larger
 * multiset size. Not as precise as APTED but stable for the trivial-rewrite
 * detection goal.
 */
function bagDistance(t1: NormalizedNode, t2: NormalizedNode): number {
  const bag1 = new Map<string, number>();
  const bag2 = new Map<string, number>();
  function fill(t: NormalizedNode, bag: Map<string, number>): void {
    const key = `${t.label}/${t.children.length}`;
    bag.set(key, (bag.get(key) ?? 0) + 1);
    for (const c of t.children) fill(c, bag);
  }
  fill(t1, bag1);
  fill(t2, bag2);
  let diff = 0;
  const keys = new Set([...bag1.keys(), ...bag2.keys()]);
  for (const k of keys) {
    diff += Math.abs((bag1.get(k) ?? 0) - (bag2.get(k) ?? 0));
  }
  return diff;
}

/* ---------------- Fallback: legacy LCS check ---------------- */

const IMPORT_RX = /^\s*(import|from|const\s+\w+\s+=\s+require|using\s+|package\s+|@\w)/;
function stripImports(s: string): string {
  return s.split("\n").filter((l) => !IMPORT_RX.test(l)).join("\n");
}

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/#.*$/gm, "")
    .replace(/"""[\s\S]*?"""/g, "");
}

function normalizeForLcs(s: string): string {
  return stripComments(stripImports(s)).replace(/\s+/g, " ").trim();
}

function longestCommonSubstring(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  let maxLen = 0;
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = (prev[j - 1] ?? 0) + 1;
        if ((curr[j] ?? 0) > maxLen) maxLen = curr[j] ?? 0;
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return maxLen;
}

function fallbackLcsCheck(
  inputSrc: string,
  outputSrc: string,
  reason: string,
): never {
  process.stderr.write(`::warning::[fallback LCS] ${reason}\n`);
  const a = normalizeForLcs(inputSrc);
  const b = normalizeForLcs(outputSrc);
  if (a.length === 0) {
    process.stdout.write("[fallback LCS] input was empty after normalize — passing\n");
    process.exit(0);
  }
  const lcsLen = longestCommonSubstring(a, b);
  const overlap = lcsLen / a.length;
  process.stdout.write(
    `[fallback LCS] input=${a.length} output=${b.length} lcs=${lcsLen} (${(overlap * 100).toFixed(1)}%)\n`,
  );
  if (overlap > 0.8) {
    process.stderr.write(
      `::error::[fallback LCS] ${(overlap * 100).toFixed(1)}% verbatim overlap. Reject as cosmetic.\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}

/* ---------------- TS parsing helpers ---------------- */

function tryParseTs(path: string, src: string): Node | null {
  try {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { allowJs: true, target: ts.ScriptTarget.ES2022 },
    });
    const ext = extname(path).toLowerCase();
    const inMemPath = ext === ".js" || ext === ".jsx" ? "in.js" : "in.ts";
    const sf = project.createSourceFile(inMemPath, src, { overwrite: true });
    return sf;
  } catch {
    return null;
  }
}

/* ---------------- Routing ---------------- */

type Mode = "ts-morph" | "tree-sitter-java" | "tree-sitter-python";

const TS_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ""]);

function pickMode(inputExt: string): Mode | null {
  if (TS_EXTS.has(inputExt)) return "ts-morph";
  if (inputExt === ".java") return "tree-sitter-java";
  if (inputExt === ".py") return "tree-sitter-python";
  return null;
}

interface ParseResult {
  inputTree: NormalizedNode;
  outputTree: NormalizedNode;
  mode: Mode;
}

function parseBoth(
  mode: Mode,
  inputPath: string,
  inputSrc: string,
  outputPath: string,
  outputSrc: string,
): ParseResult | null {
  // Output is always TS by contract — use ts-morph on it regardless of mode.
  const outAst = tryParseTs(outputPath, outputSrc);
  if (!outAst) return null;
  const outputTree = buildNormalizedTreeTs(outAst);

  if (mode === "ts-morph") {
    const inAst = tryParseTs(inputPath, inputSrc);
    if (!inAst) return null;
    return { inputTree: buildNormalizedTreeTs(inAst), outputTree, mode };
  }
  const lang: Lang = mode === "tree-sitter-java" ? "java" : "python";
  const inputTree = parseWithTreeSitter(inputSrc, lang);
  if (!inputTree) return null;
  return { inputTree, outputTree, mode };
}

/* ---------------- Main ---------------- */

function main(): void {
  const args = parseCliArgs();
  const threshold = Number.parseFloat(args.threshold ?? "0.05");

  const inputPath = resolveSourceFile(args.input, false);
  const outputPath = resolveSourceFile(args.output, true);

  const inputSrc = readFileSync(inputPath, "utf8");
  const outputSrc = readFileSync(outputPath, "utf8");

  const inputExt = extname(inputPath).toLowerCase();
  const outputExt = extname(outputPath).toLowerCase();
  const mode = pickMode(inputExt);
  if (mode === null) {
    fallbackLcsCheck(inputSrc, outputSrc, `input ext ${inputExt} unsupported`);
  }

  // tree-sitter modes still rely on ts-morph for the OUTPUT side. If the
  // output isn't TS (e.g. bad fixture where the LLM never converted away
  // from Java), parse the output with the same tree-sitter language instead
  // so we compare like-with-like.
  let parsed: ParseResult | null;
  if (
    (mode === "tree-sitter-java" && outputExt === ".java") ||
    (mode === "tree-sitter-python" && outputExt === ".py")
  ) {
    const lang: Lang = mode === "tree-sitter-java" ? "java" : "python";
    const inputTree = parseWithTreeSitter(inputSrc, lang);
    const outputTree = parseWithTreeSitter(outputSrc, lang);
    parsed = inputTree && outputTree ? { inputTree, outputTree, mode } : null;
  } else {
    parsed = parseBoth(mode, inputPath, inputSrc, outputPath, outputSrc);
  }
  if (!parsed) fallbackLcsCheck(inputSrc, outputSrc, `${mode} parse failed`);

  const { inputTree, outputTree, mode: usedMode } = parsed;
  const size1 = countNodes(inputTree);
  const size2 = countNodes(outputTree);
  const larger = Math.max(size1, size2);

  if (larger === 0) {
    process.stdout.write(`[${usedMode}] empty AST — passing vacuously\n`);
    process.exit(0);
  }

  // Zhang-Shasha on >4000 nodes is too slow in pure JS — degrade to bag.
  const useBag = size1 > 4000 || size2 > 4000;
  const distance = useBag ? bagDistance(inputTree, outputTree) : treeEditDistance(inputTree, outputTree);
  const algo = useBag ? "bag-of-subtrees (large input)" : "Zhang-Shasha";

  const normalized = distance / larger;
  process.stdout.write(
    `[${usedMode}] Input AST nodes (normalized): ${size1}\n` +
      `[${usedMode}] Output AST nodes (normalized): ${size2}\n` +
      `[${usedMode}] Tree edit distance (${algo}): ${distance}\n` +
      `[${usedMode}] Normalized distance: ${(normalized * 100).toFixed(2)}% of larger tree\n` +
      `[${usedMode}] Trivial threshold: ${(threshold * 100).toFixed(0)}%\n`,
  );

  if (normalized < threshold) {
    process.stderr.write(
      `::error::[${usedMode}] AST diff is rename-only / cosmetic — normalized ` +
        `tree-edit distance is ${(normalized * 100).toFixed(2)}% (< ${(threshold * 100).toFixed(0)}%). ` +
        `Identifiers were erased before comparison, so this is not just a ` +
        `variable rename — the structures are nearly identical. ` +
        `The LLM appears to have copied the input verbatim. Reject migration.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`[${usedMode}] AST diff is substantively non-trivial — passing.\n`);
  process.exit(0);
}

main();
