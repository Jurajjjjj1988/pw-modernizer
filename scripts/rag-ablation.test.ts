#!/usr/bin/env tsx
/** Unit tests for the RAG ablation core (pure; no index file). */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ablate, tokenize, type AblationDoc } from "./rag-ablation.js";

test("tokenize drops short + stop words, lowercases", () => {
  const t = tokenize("The Dashboard greeting waitForTimeout test");
  assert.ok(t.has("dashboard") && t.has("greeting") && t.has("waitfortimeout"));
  assert.ok(!t.has("the") && !t.has("test")); // stop words
});

test("ablate: when lexically-similar plans DO share KB-IDs, retrieval beats chance (load-bearing)", () => {
  // Two clusters: 'login' plans share KB-A and similar text; 'cart' plans share KB-B.
  // The top lexical neighbour of a login plan is another login plan → shares KB-A.
  const docs: AblationDoc[] = [
    { id: "login1", framework: "cypress", kbIds: ["KB-A"], body: "login form email password submit signin authentication flow" },
    { id: "login2", framework: "selenium-java", kbIds: ["KB-A"], body: "login form email password submit signin authentication session" },
    { id: "cart1", framework: "cypress", kbIds: ["KB-B"], body: "shopping cart checkout quantity subtotal payment shipping address" },
    { id: "cart2", framework: "selenium-java", kbIds: ["KB-B"], body: "shopping cart checkout quantity subtotal payment shipping coupon" },
  ];
  const a = ablate(docs);
  assert.equal(a.retrievalPrecision, 1, "every top neighbour shares the cluster's KB-ID");
  assert.ok(a.chanceBaseline < 0.7, `chance should be lower (~1/3), got ${a.chanceBaseline}`);
  assert.ok(a.lift >= 0.2 && a.verdict === "load-bearing", `lift=${a.lift} verdict=${a.verdict}`);
});

test("ablate: when KB-IDs are unrelated to lexical similarity, retrieval is decorative", () => {
  // Similar text clusters, but KB-IDs assigned so neighbours DON'T share them.
  const docs: AblationDoc[] = [
    { id: "a", framework: "cypress", kbIds: ["KB-1"], body: "alpha alpha alpha shared shared shared common common terms terms" },
    { id: "b", framework: "cypress", kbIds: ["KB-2"], body: "alpha alpha alpha shared shared shared common common terms terms" },
    { id: "c", framework: "cypress", kbIds: ["KB-3"], body: "alpha alpha alpha shared shared shared common common terms terms" },
    { id: "d", framework: "cypress", kbIds: ["KB-4"], body: "alpha alpha alpha shared shared shared common common terms terms" },
  ];
  const a = ablate(docs);
  assert.equal(a.retrievalPrecision, 0, "no neighbour shares a KB-ID");
  assert.equal(a.verdict, "decorative");
});

test("ablate: a corpus with <2 KB-bearing docs is decorative (no signal)", () => {
  const a = ablate([{ id: "x", framework: "cypress", kbIds: [], body: "anything" }]);
  assert.equal(a.verdict, "decorative");
  assert.equal(a.n, 0);
});
