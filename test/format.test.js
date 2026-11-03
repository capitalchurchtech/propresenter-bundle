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

test("line spacing as ProPresenter writes it: \\sl in twentieths with \\slmult1 on every paragraph, and the paragraph style; single writes neither", async () => {
  const { setLineSpacing } = await import("../src/index.js");
  const { doc, schema } = open("show-template.pro");
  const x = firstText(doc);
  setLineSpacing(x.wrapper, 1.3);
  const paras = rtf(x).match(/\\pard(?![a-z])/g).length;
  assert.equal((rtf(x).match(/\\sl312\\slmult1/g) ?? []).length, paras);
  assert.equal(x.element.text.attributes.paragraph_style.line_height_multiple, 1.3);
  setLineSpacing(x.wrapper, 1);
  assert.doesNotMatch(rtf(x), /\\sl-?\d/);
  assert.throws(() => setLineSpacing(x.wrapper, 9), /0\.1 to 5/);
  stillGood(schema, doc);
});

test("a slide's notes: set with line breaks and any characters, read back as text, removed when empty", async () => {
  const { setNotes, notesOf } = await import("../src/index.js");
  const { doc, schema } = open("show-template.pro");
  const action = doc.cues[0].actions.find((a) => a.slide);
  setNotes(action, "Lights: 139,1\nCue the band — {ready}");
  assert.equal(notesOf(action), "Lights: 139,1\nCue the band — {ready}");
  stillGood(schema, doc);
  setNotes(action, "  ");
  assert.equal(action.slide.presentation.notes, undefined);
  assert.equal(notesOf(action), "");
  assert.throws(() => setNotes({}, "x"), /Only a presentation slide/);
});

test("an outline round the letters, as ProPresenter writes it, kept when the words change; shadow, feather, margins", async () => {
  const { setTextOutline, setTextShadow, setFeather, setMargins, setText, markdownRuns } = await import("../src/index.js");
  const { doc, schema } = open("show-template.pro");
  const x = firstText(doc);
  setTextOutline(x.wrapper, { width: 2, color: "#ffffff" });
  assert.match(rtf(x), /\\cf2 \\outl0\\strokewidth-40 \\strokec3 /, "ProPresenter's own spacing");
  assert.match(rtf(x), /\{\\colortbl;\\red255\\green255\\blue255;\\red255\\green255\\blue255;\\red255\\green255\\blue255;\}/, "the outline's colour added as entry 3");
  assert.deepEqual([x.element.text.attributes.stroke_width, x.element.text.attributes.stroke_color.red], [-2, 1]);
  setText(x.wrapper, markdownRuns("New words"));
  assert.match(rtf(x), /\\outl0\\strokewidth-40 \\strokec3 New words/, "rebuilt words keep the outline");
  setTextOutline(x.wrapper, "none");
  assert.doesNotMatch(rtf(x), /outl0/);
  setTextShadow(x.wrapper, true);
  setFeather(x.wrapper, 0.4);
  setMargins(x.wrapper, { left: 20, right: 20 });
  const box = toModel(doc).groups.flatMap((g) => g.slides).flatMap((s) => s.elements).find((e) => e.uuid === x.element.uuid.string);
  assert.deepEqual([box.textShadow?.radius, box.feather, box.margins?.left, box.textOutline], [5, 0.4, 20, undefined]);
  assert.throws(() => setFeather(x.wrapper, 3), /0 \(none\) to 1/);
  assert.throws(() => setTextOutline(x.wrapper, { width: 99, color: "#000000" }), /at most 50/);
  stillGood(schema, doc);
});

test("a list, as ProPresenter 21 writes one: list table, hanging indent, a marker on each line, kept when the words change", async () => {
  const { setList, setText, markdownRuns, readableText } = await import("../src/index.js");
  const { doc, schema } = open("show-template.pro");
  const x = firstText(doc);
  setText(x.wrapper, markdownRuns("One\nTwo"));
  setList(x.wrapper, "1.");
  // The table ProPresenter wrote for "1." on its own test sheet, character for character.
  assert.ok(rtf(x).includes("{\\*\\listtable{\\list\\listtemplateid1\\listhybrid{\\listlevel\\levelnfc0\\levelnfcn0\\leveljc0\\leveljcn0\\levelfollow0\\levelstartat1\\levelspace360\\levelindent0{\\*\\levelmarker \\{decimal\\}.}{\\leveltext\\leveltemplateid1\\'02\\'00.;}{\\levelnumbers\\'01;}\\fi-360\\li720\\lin720 }{\\listname ;}\\listid1}}\n{\\*\\listoverridetable{\\listoverride\\listid1\\listoverridecount0\\ls1}}\n"));
  assert.match(rtf(x), /\\pard\\tx20\\tx1600(\\pardeftab\d+)?\\li1600\\fi-1600/);
  assert.match(rtf(x), /\{\\listtext\t1\.\t\}One\\\n\\ls1\\ilvl0\{\\listtext\t2\.\t\}Two/);
  assert.equal(readableText(rtf(x)), "One\nTwo", "a marker is not words");
  const ps = x.element.text.attributes.paragraph_style;
  assert.deepEqual([ps.text_list, ps.head_indent, ps.tab_stops], [{ is_enabled: true, number_type: 7, postfix: ".", starting_number: 1 }, 80, [{ location: 1 }, { location: 80, alignment: 4 }]]);

  setList(x.wrapper, { style: "(A)", start: 3 });
  assert.ok(rtf(x).includes("{\\*\\levelmarker (\\{upper-alpha\\})}{\\leveltext\\leveltemplateid1\\'03(\\'00);}{\\levelnumbers\\'02;}"));
  assert.match(rtf(x), /\{\\listtext\t\(C\)\t\}One/);
  setText(x.wrapper, markdownRuns("One\nTwo\nThree"));
  assert.match(rtf(x), /\{\\listtext\t\(E\)\t\}Three/, "new words get the markers again");
  assert.equal(rtf(x).match(/\\listtable/g).length, 1);
  const box = () => toModel(doc).groups.flatMap((g) => g.slides).flatMap((s) => s.elements).find((e) => e.uuid === x.element.uuid.string);
  assert.deepEqual(box().list, { style: "(A)", start: 3 });

  setList(x.wrapper, "disc");
  assert.ok(rtf(x).includes("{\\leveltext\\leveltemplateid1\\'01\\uc0\\u8226 ;}{\\levelnumbers;}"));
  assert.match(rtf(x), /\{\\listtext\t\\uc0\\u8226 \t\}One/);
  stillGood(schema, doc);

  setList(x.wrapper, "none");
  assert.doesNotMatch(rtf(x), /listtable|listtext|\\ls1|\\tx20|\\fi-/);
  assert.deepEqual([x.element.text.attributes.paragraph_style.text_list, box().list], [{}, undefined]);
  assert.throws(() => setList(x.wrapper, "roman"), /bullet .* or a number/);
  assert.throws(() => setList(x.wrapper, { style: "1.", start: 0 }), /whole number from 1/);
  stillGood(schema, doc);
});

test("a list's marker styled apart from its words keeps that style when the list is rebuilt", async () => {
  const { listRtf } = await import("../src/index.js");
  const bold = "{\\rtf1\\ansi\n{\\colortbl;\\red255\\green255\\blue255;}\n\\deftab1300\n\\pard\\pardeftab1300\\pardirnatural\n\n\\f0\\fs80 \\cf2 {\\listtext\t\n\\f1\\b 1.\n\\f0\\b0 \t}One\\\nTwo}";
  const out = listRtf(bold, { number_type: 9, postfix: ")", starting_number: 1, indent: 80 });
  assert.match(out, /\{\\listtext\t\n\\f1\\b A\)\n\\f0\\b0 \t\}One\\\n\\ls1\\ilvl0\{\\listtext\t\n\\f1\\b B\)\n\\f0\\b0 \t\}Two/);
  assert.equal(listRtf("{\\rtf1 \\cf2 plain}", null), "{\\rtf1 \\cf2 plain}", "a box with no list is left alone");
});
