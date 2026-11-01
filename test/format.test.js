// The slide editor's box settings, on the invented fixtures: each written where ProPresenter keeps it (both
// places, where it keeps two), and the presentation still passing its own check afterwards.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodePresentation, encodePresentation, checkPresentationBytes, toModel, elementsOf,
  setTextColor, setAlignment, setVerticalAlignment, setTextFit, setCapitals, setFont, setBoxStyle, arrangeBox, parseColor,
} from "../src/index.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const open = (f) => decodePresentation(fs.readFileSync(path.join(FIX, f)));
const firstText = (doc) => elementsOf(doc).find((x) => x.element.text?.rtf_data);
const rtf = (x) => Buffer.from(x.element.text.rtf_data).toString("latin1");
const stillGood = (schema, doc) => assert.equal(checkPresentationBytes(encodePresentation(schema, doc)).ok, true, "the presentation still passes its check");

test("words' colour goes in the RTF colour table, both forms, and the text fill", () => {
  const { doc, schema } = open("show-template.pro");
  const x = firstText(doc);
  setTextColor(x.wrapper, "#cc2929");
  assert.match(rtf(x), /\{\\colortbl;\\red255\\green255\\blue255;\\red204\\green41\\blue41;\}/);
  assert.match(rtf(x), /\{\\\*\\expandedcolortbl;;\\csgenericrgb\\c80000\\c16078\\c16078;\}/);
  assert.ok(!/\\cf[013-9]/.test(rtf(x)) && /\\cf2/.test(rtf(x)), "every run in colour 2");
  assert.deepEqual(x.element.text.attributes.text_solid_fill, parseColor("#cc2929"));
  assert.throws(() => setTextColor(x.wrapper, "red"), /#rrggbb/);
  stillGood(schema, doc);
});

test("alignment in the paragraph style and on every RTF paragraph; left is written as ProPresenter does, with no \\ql", () => {
  const { doc, schema } = open("show-template.pro");
  const x = firstText(doc);
  setAlignment(x.wrapper, "center");
  assert.equal(x.element.text.attributes.paragraph_style.alignment, 2);
  assert.equal(rtf(x).match(/\\pard(?![a-z])/g).length, rtf(x).match(/\\pard\\qc/g).length);
  setAlignment(x.wrapper, "left");
  assert.equal(x.element.text.attributes.paragraph_style.alignment, 0);
  assert.doesNotMatch(rtf(x), /\\q[lcrj](?![a-z])/);
  setVerticalAlignment(x.wrapper, "bottom");
  setTextFit(x.wrapper, "shrink_text");
  assert.deepEqual([x.element.text.vertical_alignment, x.element.text.scale_behavior], [2, 2]);
  assert.throws(() => setAlignment(x.wrapper, "middle"), /left, center, right or justify/);
  stillGood(schema, doc);
});

test("capitals over the box's words, and a new typeface with bold runs taking its bold", () => {
  const { doc, schema } = open("show-template.pro");
  const x = firstText(doc);
  setCapitals(x.wrapper, "all");
  assert.equal(x.element.text.attributes.custom_attributes.filter((c) => c.capitalization).length, 1);
  setFont(x.wrapper, { name: "Georgia", family: "Georgia" });
  assert.match(rtf(x), /\{\\fonttbl\\f0\\fnil\\fcharset0 Georgia;\\f1\\fnil\\fcharset0 Georgia-Bold;\}/);
  const box = toModel(doc).groups.flatMap((g) => g.slides).flatMap((s) => s.elements).find((e) => e.uuid === x.element.uuid.string);
  assert.deepEqual([box.fontName, box.fontFamily, box.caps], ["Georgia", "Georgia", true]);
  setCapitals(x.wrapper, "none");
  assert.equal(x.element.text.attributes.custom_attributes.filter((c) => c.capitalization).length, 0);
  assert.throws(() => setFont(x.wrapper, { name: "Georgia" }), /family/);
  stillGood(schema, doc);
});

test("a box's own look, and a picture box's fill left alone", () => {
  const { doc, schema } = open("sample-fixed.pro");
  const text = firstText(doc), picture = elementsOf(doc).find((x) => x.element.fill?.media);
  setBoxStyle(text.wrapper, { fill: "#000000", outline: "#ffffff", outline_width: 4, shadow: true, rotation: -90, opacity: 0.5, hidden: true, locked: true });
  const e = text.element;
  assert.deepEqual([e.fill.enable, e.stroke.enable, e.stroke.width, e.shadow.enable, e.rotation, e.opacity, e.hidden, e.locked], [true, true, 4, true, 270, 0.5, true, true]);
  setBoxStyle(text.wrapper, { fill: "none", outline_width: 0 });
  assert.deepEqual([e.fill.enable, e.stroke.enable], [false, false]);
  assert.throws(() => setBoxStyle(picture.wrapper, { fill: "#ffffff" }), /filled with a picture/);
  assert.throws(() => setBoxStyle(text.wrapper, { opacity: 2 }), /0 \(clear\) to 1/);
  stillGood(schema, doc);
});

test("boxes arranged front to back, copied with a fresh id, and deleted", () => {
  const { doc, schema } = open("sample-fixed.pro");
  const slide = elementsOf(doc).find((x) => x.slide === "Harvest Supper");
  const base = slide.base;
  const names = () => base.elements.map((w) => w.element.name);
  const last = base.elements.at(-1);
  arrangeBox(base, last, "front");
  assert.equal(names()[0], last.element.name);
  const copyId = arrangeBox(base, last, "duplicate");
  assert.notEqual(copyId, last.element.uuid.string);
  assert.equal(names()[0], `${last.element.name} copy`);
  const before = base.elements.length;
  arrangeBox(base, last, "delete");
  assert.equal(base.elements.length, before - 1);
  assert.throws(() => arrangeBox(base, base.elements[0], "sideways"), /front, back/);
  stillGood(schema, doc);
});
