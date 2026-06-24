#!/usr/bin/env tsx
/** Unit tests for the Wilson interval — every acceptance rate must carry a CI. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { wilsonInterval, formatInterval } from "./binom.js";

const approx = (a: number, b: number, eps = 5e-3): boolean => Math.abs(a - b) < eps;

test("wilson: 3/5 at 95% has the wide small-sample interval (~0.23–0.88)", () => {
  const ci = wilsonInterval(3, 5);
  assert.equal(ci.point, 0.6);
  assert.ok(approx(ci.lo, 0.231), `lo=${ci.lo}`);
  assert.ok(approx(ci.hi, 0.882), `hi=${ci.hi}`);
});

test("wilson: 2/6 (the 33% headline) cannot be distinguished from high rates", () => {
  const ci = wilsonInterval(2, 6);
  assert.ok(approx(ci.point, 0.333));
  assert.ok(ci.lo < 0.1 && ci.hi > 0.65, `interval ${ci.lo}-${ci.hi} must be very wide at n=6`);
});

test("wilson: bounds stay inside [0,1] at the extremes; n=0 is the full interval", () => {
  const all = wilsonInterval(5, 5);
  assert.ok(all.hi <= 1 && all.lo > 0.5, `5/5 -> ${all.lo}-${all.hi}`);
  const none = wilsonInterval(0, 5);
  assert.ok(none.lo === 0 && none.hi < 0.5, `0/5 -> ${none.lo}-${none.hi}`);
  const empty = wilsonInterval(0, 0);
  assert.deepEqual([empty.lo, empty.hi], [0, 1]);
});

test("wilson: a large n tightens the interval around the point", () => {
  const ci = wilsonInterval(960, 1000);
  assert.ok(ci.hi - ci.lo < 0.03, `n=1000 interval should be tight, got ${ci.hi - ci.lo}`);
});

test("wilson: rejects invalid k/n", () => {
  assert.throws(() => wilsonInterval(6, 5));
  assert.throws(() => wilsonInterval(-1, 5));
});

test("formatInterval renders point + CI + n", () => {
  const s = formatInterval(wilsonInterval(3, 5));
  assert.match(s, /60\.0% \(95% CI 23\.\d%–88\.\d%, n=5\)/);
});
