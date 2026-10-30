import { test } from "node:test";
import assert from "node:assert/strict";
import { createGeometry, tableMetrics, fallbackMetrics, markdownRuns, linePitch, LINE_PADDING, BOX_PAD } from "../src/index.js";

// A made-up monospaced table, so every width here can be worked out by hand: at 60pt a letter is 30px
// (33px in the head and bold faces) and a space 15px.
const mono = tableMetrics({ body: { d: 500, w: { " ": 250 } }, head: { d: 550, w: { " ": 250 } }, bold: { d: 550, w: { " ": 250 } } });
const g = createGeometry({ metrics: mono });
const lines = (t, w) => g.wrapRuns(markdownRuns(t), 60, w - LINE_PADDING * 2).map((l) => l.map((x) => x.text).join(" "));

test("the box behind a bold phrase starts after the words before it, padded each side", () => {
  // "Grab one from " is 375px, the text starts 5px in, and the box has 4px of room each side.
  const [b] = g.boldBoxes(markdownRuns("Grab one from **the back table** and follow along."), 60, 2000, linePitch(60), 84);
  assert.deepEqual(b, { x: LINE_PADDING + 375 - BOX_PAD, y: 0, w: 426 + BOX_PAD * 2, h: 84 });
  assert.equal(linePitch(60), 72);
  assert.ok(Math.abs(linePitch(80, 0.8) - 76.8) < 1e-9);
});

test("a bold phrase that wraps gets one box per line, a line pitch apart", () => {
  const boxes = g.boldBoxes(markdownRuns("Supper **on October 11 after the second gathering**."), 60, 500, 72, 84);
  assert.ok(boxes.length >= 2);
  assert.deepEqual(boxes.map((b) => b.y), boxes.map((_, i) => boxes[0].y + i * 72));
});

test("wrapping allows for the 5px inset each side, so a word that only just fits the box still wraps", () => {
  // "Thursdays at 6:30pm in Room" is 27 letters and spaces: 22 x 30 + 5 x 15 = 735px.
  assert.deepEqual(lines("Thursdays at 6:30pm in Room 110.", 744), ["Thursdays at 6:30pm in", "Room 110."]);
  assert.deepEqual(lines("Thursdays at 6:30pm in Room 110.", 900).length, 1);
});

test("titles are counted in lines in the head face", () => {
  assert.equal(g.titleLines("Harvest Supper", 80, 700), 1);
  assert.equal(g.titleLines("Harvest Supper", 80, 600), 2);
});

const natural = (t, w) => g.withoutOrphan(t, 60, w);

test("a date stays whole, and the line count does not change", () => {
  // Greedy: "Register now to join us October / 11 after service."
  assert.equal(natural("Register now to join us October 11 after service.", 900), "Register now to join us\nOctober 11 after service.");
});

test("a line breaks on a comma when one is in reach", () => {
  assert.equal(natural("Join us on **October 23, 2026**, bring a dish to share, and stay for pizza.", 900),
    "Join us on **October 23, 2026**,\nbring a dish to share,\nand stay for pizza.");
});

test("a time stays with its pm, and a bold phrase is not left on a weak word", () => {
  const out = natural("Bring your own snacks and costumes for **October 25 at 5:00 pm**.", 800);
  assert.equal(out, "Bring your own snacks\nand costumes for **October 25\nat 5:00 pm**.");
  assert.ok(!/\d\npm/.test(out));
});

test("a one-word last line takes a word from the line above", () => {
  // Greedy leaves "family." alone.
  assert.deepEqual(lines("Bring a chair and a friend to the lawn and eat with the family.", 800).at(-1), "family.");
  const out = natural("Bring a chair and a friend to the lawn and eat with the family.", 800);
  assert.ok(out.split("\n").at(-1).split(" ").length >= 2, out);
});

test("text that wraps well, a single line, and breaks already typed are left alone", () => {
  assert.equal(natural("Thursdays at 6:30pm in Room 110.", 1000), "Thursdays at 6:30pm in Room 110.");
  assert.equal(natural("Harvest Supper:\nBring a Dish", 900), "Harvest Supper:\nBring a Dish");
});

test("breaking more naturally never adds a line and never changes the words", () => {
  for (const w of [700, 800, 900, 1000]) {
    for (const t of [
      "Join us on **October 23, 2026**, bring a dish to share, and stay for pizza.",
      "Bring your own snacks and costumes for **October 25 at 5:00 pm**.",
      "Bring a chair and a friend to the lawn and eat with the family.",
      "Register now to join us October 11 after service.",
    ]) {
      const out = natural(t, w);
      assert.equal(lines(out, w).length, lines(t, w).length, `${w}: ${t}`);
      assert.equal(out.replace(/\n/g, " "), t);
    }
  }
});

test("the fallback metrics say they are not measured, and a measured table says it is", () => {
  assert.equal(fallbackMetrics.measured, false);
  assert.equal(mono.measured, true);
  assert.equal(createGeometry().metrics, fallbackMetrics);
  assert.ok(fallbackMetrics.widthOf("mmm", 10) > fallbackMetrics.widthOf("iii", 10));
});

test("another language's break rules can be passed in", () => {
  const g2 = createGeometry({ metrics: mono, breaks: { weakEnd: new Set(["el", "la", "de"]), month: /^octubre$/, dayPart: /^h\b/, numbered: /^sala$/ } });
  const out = g2.withoutOrphan("Traiga un plato y quédese para la cena de la noche.", 60, 800);
  assert.ok(!/ (el|la|de)\n/.test(out), out);
});
