// Themes (.protheme): open one, read its slides and boxes, rename a box, and write a checked copy that keeps
// everything else exactly as it was. On the invented theme scripts/make-fixtures.js builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readThemeFile, readBundle, renameElement, writeTheme, checkThemeBytes, openFile, openTheme, decodeTheme } from "../src/index.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const themeBytes = () => fs.readFileSync(path.join(FIX, "sample.protheme"));

test("a theme opens: its name, slides, boxes with their ids, and its pictures", () => {
  const { file, model, unknown } = readThemeFile(themeBytes());
  assert.equal(file.name, "Example Theme");
  assert.deepEqual(file.assets.map((a) => a.file), ["example-bg.png"]);
  assert.deepEqual(unknown, []);
  assert.deepEqual(model.slides.map((s) => s.name), ["Verse", "Quote"]);
  assert.deepEqual(model.slides[0].elements.map((e) => [e.name, e.kind]), [["Background", "image"], ["Text", "text"], ["Text", "text"]]);
  assert.match(model.slides[0].elements[1].uuid, /^[0-9A-F-]{36}$/);
  assert.deepEqual(model.slides[0].size, { w: 1920, h: 1080 });
  assert.deepEqual(model.media, ["example-bg.png"]);
  assert.equal(checkThemeBytes(file.theme).ok, true);
});

test("a presentation reader sends a theme to the theme reader, and the theme reader refuses what is not one", () => {
  assert.throws(() => openFile(themeBytes()), /theme \(\.protheme\).*readThemeFile/);
  assert.throws(() => openTheme(fs.readFileSync(path.join(FIX, "sample.pro"))), /not a theme/);
  assert.throws(() => openTheme(fs.readFileSync(path.join(FIX, "sample.probundle"))), /no Theme file/);
});

test("renaming a box changes only its name; the copy keeps every picture and the rest of the theme exactly", async () => {
  const { file, doc, schema, model } = readThemeFile(themeBytes());
  const [verse, ref] = model.slides[0].elements.slice(1);
  assert.equal(renameElement(doc, verse.uuid, "  Verse  "), 1);
  renameElement(doc, ref.uuid, "Reference");
  const out = await writeTheme(file, doc, schema);

  const again = readThemeFile(out);
  assert.deepEqual(again.model.slides[0].elements.map((e) => e.name), ["Background", "Verse", "Reference"]);
  assert.deepEqual(again.model.slides[1], { ...model.slides[1] }, "the other slide is untouched");
  const strip = (m) => m.slides.map((s) => ({ ...s, elements: s.elements.map(({ name, ...e }) => e) }));
  assert.deepEqual(strip(again.model), strip(model), "nothing but the names changed");
  const before = readBundle(themeBytes()), after = readBundle(out);
  assert.deepEqual(after.map((e) => e.name), before.map((e) => e.name), "same entries, same order");
  assert.ok(after[1].data.equals(before[1].data), "the picture is byte for byte the same");
});

test("a rename needs a real box and a real name", () => {
  const { doc, model } = readThemeFile(themeBytes());
  assert.throws(() => renameElement(doc, "00000000-0000-0000-0000-000000000000", "X"), /No box with the id/);
  assert.throws(() => renameElement(doc, model.slides[0].elements[1].uuid, "   "), /Give the box a name/);
  assert.throws(() => renameElement(doc, model.slides[0].elements[1].uuid, "x".repeat(121)), /at most 120/);
});

test("a theme with a field the schema lacks is read, but never written back", async () => {
  const file = openTheme(themeBytes());
  const extra = Buffer.concat([file.theme, Buffer.from([0xc8, 0x8c, 0x04, 0x07])]); // field 9001, a varint
  const odd = { ...file, theme: extra, entries: file.entries.map((e) => (e.name === file.themeEntry ? { ...e, data: extra } : e)) };
  const { doc, unknown, schema } = decodeTheme(extra);
  assert.equal(unknown.length, 1);
  await assert.rejects(writeTheme(odd, doc, schema), /does not understand, so it is not written back/);
});
