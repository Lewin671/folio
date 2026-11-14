// Run with Node 22+: node --experimental-strip-types --test web/tests/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { createThreadSaver } from "../src/thread-saver.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function gate() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

test("writes immediately, coalesces arrivals, and saves the final snapshot after failure", async () => {
  const calls = [], active = [];
  let errors = 0;
  const saver = createThreadSaver(async (id, pages) => {
    const next = gate();
    calls.push([id, pages]);
    active.push(next);
    await next.promise;
  }, async () => {}, () => errors++);
  saver.save("a", "title");
  saver.save("a", "scene_done");
  saver.save("a", "image1");
  saver.save("a", "image2");
  assert.deepEqual(calls, [["a", "title"]]);
  active.shift().resolve();
  await tick();
  assert.deepEqual(calls, [["a", "title"], ["a", "image2"]]);
  saver.save("a", "final");
  active.shift().reject(new Error("offline"));
  await tick();
  assert.equal(errors, 1);
  assert.deepEqual(calls.at(-1), ["a", "final"]);
  active.shift().resolve();
  await tick();
  assert.equal(calls.length, 3);
});

test("cancel reverts a draft and thread switching retains each finished conversation", async () => {
  const first = gate(), calls = [];
  const saver = createThreadSaver(async (id, pages) => {
    calls.push([id, pages]);
    if (calls.length === 1) await first.promise;
  }, async () => {}, assert.fail);
  saver.save("a", "unfinished");
  saver.save("a", "image");
  saver.save("a", "finished pages");
  saver.save("b", "title");
  saver.save("b", "final");
  assert.equal(calls.length, 1);
  first.resolve();
  await tick();
  assert.deepEqual(calls, [["a", "unfinished"], ["a", "finished pages"], ["b", "final"]]);
});

test("delete replaces pending drafts, waits for writes, and reports failure without stalling", async () => {
  const writing = gate(), removing = gate(), calls = [];
  const saver = createThreadSaver(async (id) => {
    calls.push(`write ${id}`);
    if (id === "a") await writing.promise;
  }, async (id) => {
    calls.push(`delete ${id}`);
    return removing.promise;
  }, assert.fail);
  saver.save("a", "title");
  saver.save("a", "draft");
  const deleted = saver.remove("a");
  assert.equal(saver.remove("a"), deleted);
  saver.save("a", "stale draft");
  saver.save("b", "final");
  assert.deepEqual(calls, ["write a"]);
  writing.resolve();
  await tick();
  assert.deepEqual(calls, ["write a", "delete a"]);
  const failure = assert.rejects(deleted, /offline/);
  removing.reject(new Error("offline"));
  await failure;
  await tick();
  assert.deepEqual(calls, ["write a", "delete a", "write b"]);
  saver.save("a", "retry after failure");
  await tick();
  assert.equal(calls.at(-1), "write a");
});
