import assert from "node:assert/strict";
import { test } from "node:test";
import { hasImageFile, imageFile } from "../src/composer-files.ts";

const photo = new File(["image"], "photo.png", { type: "image/png" });
const text = new File(["text"], "note.txt", { type: "text/plain" });
const item = (file) => ({ kind: "file", type: file.type, getAsFile: () => file });

test("paste and drop select the first image among mixed files", () => {
  const data = { files: [text, photo], items: [item(text), item(photo)] };
  assert.equal(hasImageFile(data), true);
  assert.equal(imageFile(data), photo);
});

test("clipboard items work without files and skip unavailable image entries", () => {
  const data = { files: [], items: [
    { kind: "string", type: "image/png", getAsFile: assert.fail },
    { kind: "file", type: "image/png", getAsFile: () => null },
    item(text), item(photo),
  ] };
  assert.equal(hasImageFile(data), true);
  assert.equal(imageFile(data), photo);
});

test("protected dragover accepts image metadata before file contents become available", () => {
  const data = { files: [], items: [{ kind: "file", type: "image/png", getAsFile: () => null }] };
  assert.equal(hasImageFile(data), true);
  assert.equal(imageFile(data), undefined);
});

test("plain text, non-image files and empty transfers remain untouched", () => {
  for (const data of [
    { files: [], items: [] },
    { files: [text], items: [item(text)] },
    { files: [], items: [{ kind: "string", type: "text/plain", getAsFile: assert.fail }] },
  ]) {
    assert.equal(hasImageFile(data), false);
    assert.equal(imageFile(data), undefined);
  }
});
