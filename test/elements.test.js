// Box roles and edits, on hand-built elements shaped like a theme's (invented words throughout).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoles, setText, tidyElements, fitSpeakerBox, roleFor, repointBackgrounds, tidyActions, freshCopy, tableMetrics, mediaUrl, setImage } from "../src/index.js";

const rtf = (font, fs, words) =>
  Buffer.from(`{\\rtf1\\ansi\\ansicpg1252\\cocoartf2870\n{\\fonttbl\\f0\\fnil\\fcharset0 ${font};}\n\\pard\\pardeftab1680\\partightenfactor0\n\n\\f0\\fs${fs} \\cf2 ${words}}`, "latin1");
const text = (font, fs, words, x, y, w, h) => ({
  element: { bounds: { origin: { x, y }, size: { width: w, height: h } }, text: { rtf_data: rtf(font, fs, words), attributes: { font: { name: font } } } },
});
const image = (x, y, w, h, file = "app-qr-x.png") => ({
  element: { bounds: { origin: { x, y }, size: { width: w, height: h } }, fill: { media: { url: { local: { path: `Media/Assets/${file}` } } } } },
});
// A church whose subtitles are set in Georgia Italic.
const roles = createRoles({ text: [{ role: "kicker", in: "rtf", pattern: "Georgia-Italic" }, { role: "title", in: "rtfOrFont", pattern: "Medium" }, { role: "link", in: "words", pattern: "\\.(com|org|net)\\b|@", flags: "i" }] });
const slide = () => ({
  qr: image(1171, 292, 305, 305),
  kicker: text("Georgia-Italic", 50, "come hungry", 1176, 587, 603, 63),
  title: text("HelveticaNeue-Medium", 160, "Harvest Supper", 1172, 606, 607, 236),
  desc: text("HelveticaNeue", 80, "Bring a dish to share.", 1176, 851, 601, 140),
  link: text("HelveticaNeue", 50, "example.org/supper", 1171, 968, 499, 46),
});

test("boxes are known by what is in them, by the church's own rules", () => {
  const s = slide();
  assert.equal(roles.roleOf(s.qr), "qr");
  assert.equal(roles.roleOf(s.kicker), "kicker");
  assert.equal(roles.roleOf(s.title), "title");
  assert.equal(roles.roleOf(s.desc), "description");
  assert.equal(roles.roleOf(s.link), "link");
  assert.equal(roles.roleOf(image(0, 0, 1920, 1080)), "panel");
  assert.equal(roles.roleOf(image(0, 0, 800, 500)), "photo");
  // The default rules have no kicker: that font is one church's choice.
  assert.equal(createRoles().roleOf(slide().kicker), "description");
});

test("a box's role is decided once, before its words change", () => {
  const s = slide();
  assert.equal(roles.roleOf(s.desc), "description");
  setText(s.desc, [{ text: "Details at example.org/supper", bold: false }]);
  assert.equal(roles.roleOf(s.desc), "description");
});

test("a box set in all caps keeps its capitalisation range, stretched to the new words", () => {
  const role = text("HelveticaNeue-Medium", 120, "Volunteer Lead", 241, 715, 1466, 147);
  Object.assign(role.element.text.attributes, { custom_attributes: [{ range: { end: 14 }, capitalization: 1 }] });
  setText(role, [{ text: "Volunteer Coordinator", bold: false }]);
  const ranges = role.element.text.attributes.custom_attributes;
  assert.deepEqual(ranges[0], { range: { end: 21 }, capitalization: 1 });
  assert.ok(ranges.length > 1, "the font range follows");
  const title = text("HelveticaNeue-Medium", 260, "Old", 122, 108, 1620, 543);
  setText(title, [{ text: "New title", bold: false }]);
  assert.ok(!title.element.text.attributes.custom_attributes.some((c) => c.capitalization));
});

test("a slide's objects run title first and QR near the back, each named for its job", () => {
  const s = slide();
  const shape = { element: { name: "Rectangle", bounds: { origin: { x: 0, y: 0 }, size: { width: 400, height: 84 } }, fill: { enable: true }, text: { rtf_data: rtf("HelveticaNeue", 80, ""), attributes: {} } } };
  const out = tidyElements([s.qr, s.link, shape, s.desc, s.kicker, s.title], roles.roleOf, { ownsPicture: (f) => f.startsWith("app-") });
  assert.deepEqual(out.map((e) => e.element.name), ["Title", "Subtitle", "Description", "Link", "QR code", "Highlight"]);
});

test("two boxes doing the same job keep their own names; a picture the app did not place keeps its name", () => {
  const s = slide();
  const a = text("HelveticaNeue", 80, "First note.", 100, 100, 600, 100), b = text("HelveticaNeue", 80, "Second note.", 100, 300, 600, 100);
  const logo = image(100, 100, 135, 100, "logo.png");
  const out = tidyElements([s.qr, a, b, s.title, logo], roles.roleOf);
  assert.equal(out[0], s.title);
  assert.equal(a.element.name, undefined);
  assert.equal(logo.element.name, undefined);
  assert.equal(s.qr.element.name, undefined, "not ours unless ownsPicture says so");
});

const mono = tableMetrics({ body: { d: 500, w: { " ": 250 } } });
const sizeOf = (el) => Number(/\\fs(\d+)/.exec(Buffer.from(el.element.text.rtf_data).toString("latin1"))[1]) / 2;

test("a speaker box widens for longer words, never narrows, and keeps its type while there is room", () => {
  // At 60pt each letter is 30px; "Volunteer Coordinator" is 21 characters, 20 x 30 + 15 = 615px.
  const role = text("HelveticaNeue-Light", 120, "Lead", 88, 952, 300, 67);
  fitSpeakerBox(role, "Volunteer Coordinator", 1860, mono);
  assert.equal(role.element.bounds.size.width, 615 + 14);
  assert.equal(sizeOf(role), 60);
  const wide = text("HelveticaNeue-Light", 120, "x", 88, 952, 1193, 67);
  fitSpeakerBox(wide, "Lead", 1860, mono);
  assert.equal(wide.element.bounds.size.width, 1193);
});

test("words too long for the room step the type down instead of wrapping, but not below 60%", () => {
  const name = text("HelveticaNeue", 260, "x", 35, 779, 1000, 187);
  fitSpeakerBox(name, "Alexandra Josephine Example-Sample", 1759, mono);
  assert.equal(name.element.bounds.size.width, 1759 - 35);
  assert.ok(sizeOf(name) < 130 && sizeOf(name) >= 78);
  const huge = text("HelveticaNeue", 260, "x", 35, 779, 1000, 187);
  fitSpeakerBox(huge, "A".repeat(80), 1759, mono);
  assert.equal(sizeOf(huge), 78);
});

test("an all-caps box is fitted at its capital width", () => {
  const caps = text("HelveticaNeue-Light", 120, "x", 88, 952, 100, 67);
  caps.element.text.attributes.custom_attributes = [{ range: { end: 1 }, capitalization: 1 }];
  const plain = text("HelveticaNeue-Light", 120, "x", 88, 952, 100, 67);
  // Capitals drawn wider than small letters, as in most faces.
  const wideCaps = tableMetrics({ body: { d: 650, w: { " ": 250, ...Object.fromEntries([..."abcdefghijklmnopqrstuvwxyz"].map((c) => [c, 450])) } } });
  fitSpeakerBox(caps, "Volunteer Coordinator", 1860, wideCaps);
  fitSpeakerBox(plain, "Volunteer Coordinator", 1860, wideCaps);
  assert.ok(caps.element.bounds.size.width > plain.element.bounds.size.width);
});

test("a name's line is found through case, accents, spacing and a middle initial, never a shared surname", () => {
  const table = { "Alex Rivera": "Associate Pastor", "Sam Rivera": "Worship Leader", "Jo Nuñez": "Director" };
  assert.equal(roleFor("Alex Rivera", table), "Associate Pastor");
  assert.equal(roleFor("  alex   RIVERA ", table), "Associate Pastor");
  assert.equal(roleFor("Alex Q. Rivera", table), "Associate Pastor");
  assert.equal(roleFor("Jo Nunez", table), "Director");
  assert.equal(roleFor("Chris Rivera", table), undefined);
  assert.equal(roleFor("Rivera", table), undefined);
  assert.equal(roleFor("", table), undefined);
});

const WS = "/Users/example/Library/Application Support/RenewedVision/ProPresenter/UserWorkspaces/Example";
const bgAction = (file) => ({ media: { element: { url: { local: { path: `Media/Assets/${file}` } }, image: { file: {}, drawing: { natural_size: { width: 2000, height: 1125 } } } } } });

test("a superseded background is repointed, at the new picture's size; anything else is left", () => {
  const cue = { actions: [{ slide: {} }, bgAction("old-wall.jpg"), bgAction("other.jpg")] };
  repointBackgrounds(cue, { "old-wall.jpg": { file: "new-wall.jpg", w: 5760, h: 3240 } }, WS);
  assert.equal(cue.actions[1].media.element.url.local.path, "Media/Assets/new-wall.jpg");
  assert.deepEqual(cue.actions[1].media.element.image.drawing.natural_size, { width: 5760, height: 3240 });
  assert.equal(cue.actions[2].media.element.url.local.path, "Media/Assets/other.jpg");
});

test("media URLs carry the portable relative form under root 10, and the absolute one", () => {
  const u = mediaUrl("a b.png", WS);
  assert.deepEqual(u.local, { root: 10, path: "Media/Assets/a b.png" });
  assert.equal(u.absolute_string, "file://" + encodeURI(`${WS}/Media/Assets/a b.png`));
  const el = image(0, 0, 300, 300);
  el.element.fill.media.image = { drawing: { crop_enable: true, crop_insets: { left: 80 } } };
  setImage(el, { file: "new.png", w: 600, h: 600, format: "png" }, WS);
  assert.equal(el.element.fill.media.image.drawing.crop_enable, false);
  assert.deepEqual(el.element.fill.media.image.drawing.natural_size, { width: 600, height: 600 });
});

test("actions run slide, macro, media; clear actions can go; macros repoint to the current one", () => {
  const cue = { actions: [{ media: {} }, { clear: {} }, { macro: { identification: { parameter_name: "Old" } } }, { slide: {} }] };
  tidyActions(cue, { dropClear: true, macro: { parameter_name: "Current" } });
  assert.deepEqual(cue.actions.map((a) => Object.keys(a)[0]), ["slide", "macro", "media"]);
  assert.equal(cue.actions[1].macro.identification.parameter_name, "Current");
});

test("a fresh copy renumbers UUIDs consistently but leaves workspace references alone", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const orig = { uuid: { string: id }, ref: { string: id }, macro: { parameter_uuid: { string: id } } };
  const c = freshCopy(orig);
  assert.notEqual(c.uuid.string, id);
  assert.equal(c.ref.string, c.uuid.string);
  assert.equal(c.macro.parameter_uuid.string, id);
});
