import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRoute, routeURL } from "../src/route.ts";

test("cover and conversation pages round-trip with the query intact", () => {
  const search = "?mock&timing&lang=zh&extra=a%2Fb";
  for (const [path, entry] of [
    ["/", { i: -1 }],
    ["/c/abc123", { th: "abc123", i: 0 }],
    ["/c/abc123/2", { th: "abc123", i: 1 }],
    ["/c/abc123/999", { th: "abc123", i: 998 }],
  ]) {
    assert.deepEqual(parseRoute(path), entry);
    assert.equal(routeURL(entry, search), path + search);
  }
  assert.equal(routeURL({ th: "abc123", i: -1 }), "/");
  assert.equal(routeURL({ i: 0 }), "/");
});

test("page one and leading zeroes normalize to canonical URLs", () => {
  assert.equal(routeURL(parseRoute("/c/abc123/1")), "/c/abc123");
  assert.equal(routeURL(parseRoute("/c/abc123/002")), "/c/abc123/2");
});

test("even very large page numbers can be clamped to the last saved page", () => {
  for (const page of ["9007199254740992", "9".repeat(400)]) {
    const entry = parseRoute(`/c/abc123/${page}`);
    assert.equal(entry.th, "abc123");
    assert.equal(Math.min(entry.i, 2), 2);
  }
});

test("thread ids follow the library's lowercase alphanumeric, 6–24 character rule", () => {
  for (const id of ["abc123", "0".repeat(24)]) {
    assert.deepEqual(parseRoute(`/c/${id}`), { th: id, i: 0 });
  }
  for (const id of ["short", "a".repeat(25), "ABC123", "abc-123", "abc_123", "%61bc123", "中文abc123"]) {
    assert.equal(parseRoute(`/c/${id}`), null, id);
  }
});

test("malformed routes and page numbers do not name a conversation", () => {
  for (const path of ["", "/other", "/c/", "/c/abc123/", "/c/abc123/0", "/c/abc123/-1", "/c/abc123/1.5", "/c/abc123/NaN", "/c/abc123/2/more", "/c/abc123\n"]) {
    assert.equal(parseRoute(path), null, path);
  }
});
