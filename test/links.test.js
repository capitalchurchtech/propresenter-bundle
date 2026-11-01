// Linked boxes: a box that takes its words (or colour, or picture) from elsewhere, like a slide's label or a
// timer. On an invented presentation made with the schema.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSchema, readPresentationFile, linksOf, showsOwnLabel, elementsOf } from "../src/index.js";

const uid = (n) => ({ string: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` });
const rtf = (w) => Buffer.from(`{\\rtf1\\ansi{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;}\n\\pard\n\n\\f0\\fs80 \\cf2 ${w}}`, "latin1");
const box = (n, name, words, links) => ({ element: { uuid: uid(n), name, text: { rtf_data: rtf(words), attributes: {} } }, ...(links ? { data_links: links } : {}) });

function linkedPresentation() {
  const { Presentation } = loadSchema();
  const cue = { uuid: uid(1), name: "Romans 12:2", actions: [{ uuid: uid(2), label: { text: "Romans 12:2" }, type: 11, slide: { presentation: { base_slide: { elements: [
    box(3, "Reference", "stale words from last time", [{ slide_Label_Text: {} }]),
    box(4, "Up next", "x", [{ slide_Label_Text: { slide_label_source: 1 } }]),
    box(5, "Countdown", "10:00", [{ timer_text: { timer_name: "Pre-service" } }]),
    box(6, "Words", "Do not conform"),
  ] } } } }] };
  return Buffer.from(Presentation.encode(Presentation.fromObject({ uuid: uid(9), name: "Links", cues: [cue], cue_groups: [{ group: { uuid: uid(8), name: "Main" }, cue_identifiers: [uid(1)] }] })).finish());
}

test("each link is named in plain words, and a box showing its slide's label reads as the label", () => {
  const { model, doc } = readPresentationFile(linkedPresentation());
  const els = model.groups[0].slides[0].elements;
  assert.deepEqual(els.map((e) => [e.name, e.links, e.text]), [
    ["Reference", ["slide label"], "Romans 12:2"],
    ["Up next", ["next slide's label"], "x"],
    ["Countdown", ["timer"], "10:00"],
    ["Words", [], "Do not conform"],
  ]);
  assert.deepEqual(model.groups[0].slides[0].text[0], "Romans 12:2", "the slide's words are what shows");
  const wrappers = elementsOf(doc).map((x) => x.wrapper);
  assert.deepEqual(wrappers.map(showsOwnLabel), [true, false, false, false]);
  assert.deepEqual(linksOf(wrappers[2]), [{ kind: "timer_text", name: "timer", words: true, next: false }]);
});
