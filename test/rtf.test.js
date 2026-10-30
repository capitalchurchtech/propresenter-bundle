import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRtf, buildRanges, readRangeFont, writeRangeFont, markdownRuns, linkRuns, boldOf, plainText, readableText } from "../src/index.js";

// A description box's RTF as a ProPresenter theme writes it.
const THEME = "{\\rtf1\\ansi\\ansicpg1252\\cocoartf2870\n\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;}\n{\\colortbl;\\red255\\green255\\blue255;\\red255\\green255\\blue255;}\n{\\*\\expandedcolortbl;;\\cssrgb\\c100000\\c100000\\c100000;}\n\\deftab1680\n\\pard\\pardeftab1680\\sl288\\slmult1\\pardirnatural\\partightenfactor0\n\n\\f0\\fs80 \\cf2 Sample words the theme was built with.\\\n}";

test("new words keep the theme's paragraph, size and colour, with bold as its own face", () => {
  const rtf = buildRtf(THEME, markdownRuns("Supper on **October 11th**."), "HelveticaNeue", "HelveticaNeue-Bold");
  assert.ok(rtf.startsWith(THEME.slice(0, THEME.indexOf("{\\fonttbl"))));
  assert.match(rtf, /\\sl288\\slmult1/);
  assert.match(rtf, /\{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;\\f1\\fnil\\fcharset0 HelveticaNeue-Bold;\}/);
  assert.match(rtf, /\\f0\\fs80 \\cf2 Supper on \n\\f1\\b\\fs80 \\cf2 October 11th\n\\f0\\b0\\fs80 \\cf2 \.\}$/);
});

test("the ranges line up with the runs, one font per range, adjacent same-font runs merged", () => {
  const regular = { name: "HelveticaNeue", size: 40, bold: false, family: "Helvetica Neue" };
  const r = buildRanges([{ text: "Supper on ", bold: false }, { text: "Oct", bold: true }, { text: " 11", bold: true }, { text: ".", bold: false }], regular);
  assert.deepEqual(r.map((x) => x.range), [{ end: 10 }, { start: 10, end: 16 }, { start: 16, end: 17 }]);
  assert.deepEqual(readRangeFont(r[1]._unknown_12[0]), { name: "HelveticaNeue-Bold", size: 40, bold: true, family: "Helvetica Neue" });
});

test("a range font survives being written and read back", () => {
  const f = { name: "Georgia-Italic", size: 25, bold: false, family: "Georgia" };
  assert.deepEqual(readRangeFont(writeRangeFont(f)), f);
});

test("characters RTF treats as syntax, and anything past ASCII, are escaped", () => {
  const rtf = buildRtf(THEME, [{ text: "We’re {here} \\ now", bold: false }], "HelveticaNeue", "HelveticaNeue-Bold");
  assert.match(rtf, /We\\uc0\\u8217 re \\\{here\\\} \\\\ now\}$/);
});

test("a link sets the host plain and the page bold; an email sets the name bold", () => {
  assert.deepEqual(linkRuns("example.org/supper"), [{ text: "example.org/", bold: false }, { text: "supper", bold: true }]);
  assert.deepEqual(linkRuns("example.org"), [{ text: "example.org", bold: false }]);
  assert.deepEqual(linkRuns("hello@example.org"), [{ text: "hello", bold: true }, { text: "@example.org", bold: false }]);
  assert.equal(boldOf("HelveticaNeue"), "HelveticaNeue-Bold");
  assert.equal(boldOf("HelveticaNeue-Medium"), "HelveticaNeue-Bold");
});

test("plain text drops the RTF; readable text keeps typed line breaks and decodes escapes", () => {
  const rtf = buildRtf(THEME, markdownRuns("We’re in **Room 4**\nafter {lunch}."), "HelveticaNeue", "HelveticaNeue-Bold");
  assert.equal(plainText(buildRtf(THEME, markdownRuns("Supper on **Oct 11**."), "HelveticaNeue", "HelveticaNeue-Bold")), "Supper on Oct 11.");
  assert.equal(readableText(rtf), "We’re in Room 4\nafter {lunch}.");
});

test("a Shift-Return line separator is a line break in readable text", () => {
  const rtf = "{\\rtf1\\ansi{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;}\n\\pard\\qc\n\n\\f0\\fs104 \\cf2 Morning has broken\\uc0\\u8232 like the first morning}";
  assert.equal(readableText(rtf), "Morning has broken\nlike the first morning");
});

test("Cocoa's one-byte escapes for curly quotes and dashes are decoded", () => {
  const rtf = "{\\rtf1\\ansi{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;}\n\\pard\n\n\\f0\\fs80 \\cf2 \\'91Cause it\\'92s \\'93here\\'94 \\'96 now}";
  assert.equal(readableText(rtf), "‘Cause it’s “here” – now");
  assert.equal(plainText(rtf), "‘Cause it’s “here” – now");
});
