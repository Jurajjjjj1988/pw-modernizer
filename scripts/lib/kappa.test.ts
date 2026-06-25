#!/usr/bin/env tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { cohensKappa, kappaLabel } from "./kappa.js";
test("perfect agreement → kappa 1", () => {
  assert.equal(cohensKappa([true,false,true,false],[true,false,true,false]).kappa, 1);
});
test("chance-level agreement → kappa ~0", () => {
  // judge says all true, human split 50/50 → po=0.5, pe=0.5 → kappa 0
  const r = cohensKappa([true,true,true,true],[true,true,false,false]);
  assert.ok(Math.abs(r.kappa) < 1e-9, `kappa=${r.kappa}`);
});
test("substantial agreement lands in the right band", () => {
  const a=[true,true,true,true,false,false,false,false,true,false];
  const b=[true,true,true,false,false,false,false,true,true,false]; // 8/10 agree
  const r=cohensKappa(a,b);
  assert.ok(r.kappa>=0.55 && r.kappa<0.8, `kappa=${r.kappa}`);
  assert.equal(kappaLabel(r.kappa),"substantial");
});
test("rejects length mismatch / empty", () => {
  assert.throws(()=>cohensKappa([true],[true,false]));
  assert.throws(()=>cohensKappa([],[]));
});
