// Drawing slides as HTML, on the invented fixtures. The rules themselves were found against
// ProPresenter's own pictures (docs/RENDERING.md); these hold the shape of what is drawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readPresentationFile, drawSlide, drawPresentation, fontFaces, DRAW_CSS, elementsOf, toModel,
  setList, setTextOutline, setTextShadow, setFeather, setText, markdownRuns, setBoxStyle,
} from "../src/index.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const open = (f) => readPresentationFile(fs.readFileSync(path.join(FIX, f))).doc;
const baseOf = (cue) => cue.actions.find((a) => a.slide).slide.presentation.base_slide;

test("every slide, in the order ProPresenter lists them, each box at its own position", () => {
  const doc = open("show-template.pro");
  const drawn = drawPresentation(doc);
  const model = toModel(doc).groups.flatMap((g) => g.slides);
  assert.equal(drawn.length, model.length);
  assert.deepEqual(drawn.map((s) => s.label), model.map((s) => s.label));
  const first = elementsOf(doc).find((x) => x.cue === doc.cues.find((c) => c.uuid.string === drawn[0].id) && x.element.bounds);
  const b = first.element.bounds;
  assert.ok(drawn[0].html.includes(`left:${b.origin?.x ?? 0}px;top:${b.origin?.y ?? 0}px;width:${b.size.width}px`), "a box is placed by its bounds");
  assert.match(drawn[0].html, /^<div class="slide( clear)?" style="width:1920px;height:1080px">/);
  for (const s of drawn) assert.equal(s.fonts.length > 0, /class="txt"/.test(s.html), "a slide with words lists its fonts, for the page to load");
});

test("pictures come from the caller; one it can't give is marked, not left blank", () => {
  const doc = open("sample.probundle");
  const asked = [];
  const drawn = drawPresentation(doc, { picture: (file, rel) => { asked.push([file, rel]); return file === "dot.png" ? "/pic/dot.png" : null; } });
  const files = [...new Set(drawn.flatMap((s) => s.pictures))];
  assert.ok(files.length, "the fixture uses pictures");
  assert.deepEqual([...new Set(asked.map(([f]) => f))].sort(), files.sort());
  const html = drawn.map((s) => s.html).join("");
  if (files.includes("dot.png")) assert.match(html, /src="\/pic\/dot\.png"/);
  for (const f of files.filter((f) => f !== "dot.png")) assert.ok(html.includes(`class="full missing">${f}<`) || html.includes(`class="missing">${f}<`), `${f} is marked missing`);
  assert.ok(!/data:/.test(html), "no picture is inlined");
});

test("background media carries to the next slides; foreground media ends at the next slide; a clear empties it", () => {
  const doc = open("show-template.pro");
  const media = doc.cues.flatMap((c) => c.actions).find((a) => a.media);
  assert.ok(media, "the fixture has a media action");
  for (const cue of doc.cues) cue.actions = cue.actions.filter((x) => !x.media);
  const byId = new Map(doc.cues.map((c) => [c.uuid.string, c]));
  const [a, b, c] = drawPresentation(doc).slice(0, 3).map((s) => byId.get(s.id));
  a.actions.push({ ...structuredClone(media), media: { ...structuredClone(media.media), layer_type: 0 } });
  c.actions.push({ isEnabled: true, clear: { target_layer: 0 } });
  const playing = () => drawPresentation(doc, { picture: () => "u" }).slice(0, 3).map((s) => s.html.includes('<div class="full"><'));
  assert.deepEqual(playing(), [true, true, false]);
  a.actions.at(-1).media.layer_type = 1;
  assert.deepEqual(playing(), [true, false, false], "foreground ends at the next slide");
});

test("a list draws its markers with the hanging indent and stops; an outline and a shadow on the letters; feather on the fill, not the words; a dashed outline", () => {
  const doc = open("show-template.pro");
  const x = elementsOf(doc).find((e) => e.element.text?.rtf_data);
  setText(x.wrapper, markdownRuns("One\nTwo"));
  setList(x.wrapper, "1.");
  setTextOutline(x.wrapper, { width: 3, color: "#ffffff" });
  setTextShadow(x.wrapper, true);
  setFeather(x.wrapper, 0.25);
  setBoxStyle(x.wrapper, { fill: "#ff0000", outline: "#ffffff", outline_width: 4 });
  x.element.stroke.style = 2;
  const { html } = drawSlide(baseOf(x.cue), x.cue.actions);
  assert.match(html, /data-stops="1,80"/, "the list's tab stops");
  assert.match(html, /padding-left:80px;text-indent:-80px/, "the hanging indent");
  assert.match(html, /1\.<span class="tab"><\/span>/, "the marker, then a tab to the words");
  assert.match(html, /-webkit-text-stroke:[\d.]+px rgb\(255,255,255\)/);
  assert.match(html, /text-shadow:3\.5px 3\.5px 5px rgba\(0,0,0,0\.75\)/, "ProPresenter's default shadow, down and to the right");
  const h = x.element.bounds.size.height, f = (2.2 * 0.25 * Math.min(x.element.bounds.size.width, h)).toFixed(1);
  assert.match(html, new RegExp(`<div class="full" style="background:rgba\\(255,0,0,1\\);-webkit-mask-image:linear-gradient\\(to right,transparent 0px,#000 ${f}px`), "the fill fades in from its edges");
  assert.doesNotMatch(html, /class="txt"[^>]*mask-image/, "the words do not fade");
  assert.match(html, /stroke-dasharray="8 8"/, "style 2 is dashes twice the outline's width");
  assert.doesNotMatch(html, /outline:4px solid/);
});

test("a box's name is escaped; font faces are named only when the name is safe", () => {
  const doc = open("show-template.pro");
  const x = elementsOf(doc).find((e) => e.element.text?.rtf_data);
  x.element.name = `Title "<b>`;
  const { html } = drawSlide(baseOf(x.cue), x.cue.actions);
  assert.ok(html.includes('data-n="Title &quot;&lt;b&gt;"'));
  assert.equal(fontFaces(["HelveticaNeue-Bold", 'Evil"){}']), '@font-face{font-family:"ps-HelveticaNeue-Bold";src:local("HelveticaNeue-Bold");font-weight:700;}');
  assert.match(DRAW_CSS, /^\.slide\{/);
});

test("draw.js is pure: it imports nothing, so it can run anywhere", () => {
  const src = fs.readFileSync(path.join(FIX, "..", "..", "src", "draw.js"), "utf8");
  assert.doesNotMatch(src, /^\s*import /m);
  assert.doesNotMatch(src, /require\(|process\.|child_process|node:fs/);
});

test("a crafted font name can't close its CSS string and add a rule", () => {
  const doc = open("show-template.pro");
  const x = elementsOf(doc).find((e) => e.element.text?.rtf_data);
  const evil = "Helvetica');background:url(https://example.invalid/x);font-family:('";
  x.element.text.rtf_data = Buffer.from(`{\\rtf1\\ansi{\\fonttbl\\f0\\fnil\\fcharset0 ${evil};}\n{\\colortbl;\\red255\\green255\\blue255;}\n\\pard\n\n\\f0\\fs80 \\cf1 Words}`, "latin1");
  x.element.text.attributes = { ...(x.element.text.attributes ?? {}), font: { name: evil, family: evil, size: 40 } };
  const { html } = drawSlide(baseOf(x.cue), x.cue.actions);
  assert.ok(html.includes("Words"));
  assert.doesNotMatch(html, /url\(https/);
  assert.doesNotMatch(html, /'ps-[^']*\)/, "no parenthesis or quote survives inside a font name");
});

test("a theme whose picture address is malformed says nothing about its workspace, rather than throwing", async () => {
  const { themeWorkspace } = await import("../src/index.js");
  assert.equal(themeWorkspace({ slides: [{ url: { absolute_string: "file:///Users/x/Themes/%E0%A4%A/a.png" } }] }), null);
});
