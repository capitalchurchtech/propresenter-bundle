// Reading, comparing and checking whole files: the synthetic fixtures from scripts/make-fixtures.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  readPresentationFile, openFile, decodePresentation, encodePresentation, checkPresentationBytes, findUnknownFields,
  loadSchema, diffModels, checkFile, createRoles, readBundle, writeBundle, tableMetrics,
} from "../src/index.js";

const fixture = (name) => fs.readFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)));
const roles = createRoles({ text: [{ role: "kicker", in: "rtf", pattern: "Georgia-Italic" }, ...createRoles().rules.text] });

test("a bundle opens to its presentation and its media; a bare .pro opens as itself", () => {
  const b = openFile(fixture("sample.probundle"));
  assert.equal(b.kind, "probundle");
  assert.equal(b.proName, "Example Sunday.pro");
  assert.deepEqual(b.media.map((m) => m.file).sort(), ["example-bg.png", "example-qr.png"]);
  const p = openFile(fixture("sample.pro"));
  assert.equal(p.kind, "pro");
  assert.ok(p.pro.equals(fixture("sample.pro")));
});

test("the model has the groups, slides, labels, words, boxes, media and macros, in ProPresenter's order", () => {
  const { model } = readPresentationFile(fixture("sample.pro"), { roles });
  assert.equal(model.name, "Example Sunday");
  assert.deepEqual(model.groups.map((g) => g.name), ["Opening", "Announcements"]);
  assert.deepEqual(model.groups[1].slides.map((s) => s.label), ["Harvest Supper", "Blank"]);
  const supper = model.groups[1].slides[0];
  assert.deepEqual(supper.elements.map((e) => e.role), ["qr", "link", "description", "kicker", "title", "panel"]);
  assert.ok(supper.text.includes("Harvest Supper"));
  assert.equal(supper.elements.find((e) => e.role === "qr").media, "example-qr.png");
  const intro = model.groups[0].slides[1];
  assert.deepEqual(intro.macros, [{ name: "Lower Thirds", uuid: "00000000-0000-4000-9000-00000000AAAA", collection: "Example Service", collectionUuid: "00000000-0000-4000-9000-00000000BBBB" }]);
  assert.deepEqual(intro.actionOrder, ["slide", "media", "macro"]);
  assert.equal(model.groups[0].color, "#3366cc");
  assert.deepEqual(model.arrangements, [{ name: "Full", groups: ["Opening", "Announcements"] }]);
  assert.equal(model.slideCount, 4);
});

test("a field the schema lacks is found by the raw walk, and carried through a re-save", () => {
  const buf = fixture("sample.pro");
  const unknown = findUnknownFields(loadSchema().Presentation, buf);
  assert.deepEqual(unknown.map((u) => [u.type, u.field]), [["rv.data.Presentation", 9001]]);
  const { doc, schema } = decodePresentation(buf);
  const again = encodePresentation(schema, doc);
  assert.deepEqual(findUnknownFields(loadSchema().Presentation, again).map((u) => u.field), [9001], "still there after writing back");
  const check = checkPresentationBytes(buf);
  assert.equal(check.stable, true);
  assert.equal(check.ok, false, "not ok while something is unread");
  assert.equal(checkPresentationBytes(fixture("sample-fixed.pro")).ok, true);
});

test("garbage is reported, not thrown", () => {
  const r = checkPresentationBytes(Buffer.from("not a presentation at all, just words"));
  assert.equal(r.ok, false);
});

test("the diff finds what the operator changed by hand", () => {
  const a = readPresentationFile(fixture("sample.pro"), { roles }).model;
  const b = readPresentationFile(fixture("sample-fixed.pro"), { roles }).model;
  const d = diffModels(a, b);
  assert.deepEqual(d.added, ["Announcements / Thank You"]);
  assert.deepEqual(d.removed, []);
  const supper = d.changed.find((c) => c.slide === "Announcements / Harvest Supper").changes;
  assert.ok(supper.some((c) => c.what === "renamed" && c.before === "Harvest Supper" && c.after === "Title"));
  assert.ok(supper.some((c) => c.what === "moved or resized" && c.box === "Title" && c.before === "122,120 1600x120" && c.after === "122,100 1600x180"));
  assert.ok(supper.some((c) => c.what === "objects order"));
  const intro = d.changed.find((c) => c.slide === "Opening / Speaker Intro").changes;
  assert.ok(intro.some((c) => c.what === "media" && c.after === ""));
  assert.ok(intro.some((c) => c.what === "capitals" || c.what === "action order"));
  assert.deepEqual(diffModels(a, a), { added: [], removed: [], changed: [], groups: null, arrangements: null });
});

test("the check finds the unknown field, the missing picture, short capitals, overflow and object order", () => {
  const { findings, predicted } = checkFile(fixture("sample.probundle"), { roles });
  const codes = findings.map((f) => f.code);
  assert.equal(predicted, "rough");
  assert.ok(codes.includes("unknown-field"));
  assert.ok(findings.some((f) => f.code === "missing-media" && /example-panel\.png/.test(f.message)));
  assert.ok(findings.some((f) => f.code === "caps-lost" && f.slide === "Opening / Speaker Intro" && f.box === "Role"));
  assert.ok(findings.some((f) => f.code === "object-order" && f.slide === "Announcements / Harvest Supper"));
  assert.ok(findings.some((f) => f.code === "overflow" && /rough guess/.test(f.message)));
  assert.ok(codes.includes("macros-not-checked"));
});

test("macros and media are checked when the caller knows what the workspace has", () => {
  const stale = checkFile(fixture("sample.pro"), { roles, knownMacros: new Set(["some-other-macro"]), hasMedia: (f) => f !== "example-bg.png" });
  assert.ok(stale.findings.some((f) => f.code === "stale-macro" && f.slide === "Opening / Speaker Intro"));
  assert.ok(stale.findings.some((f) => f.code === "missing-media" && /example-bg\.png/.test(f.message)));
  assert.ok(!stale.findings.some((f) => f.code === "macros-not-checked" || f.code === "media-not-checked"));
});

test("with a measured table, layout findings are not labelled a guess", () => {
  const mono = tableMetrics({ body: { d: 500, w: { " ": 250 } } });
  const { findings, predicted } = checkFile(fixture("sample-fixed.pro"), { roles, metrics: mono });
  assert.equal(predicted, "measured");
  assert.ok(!findings.some((f) => /rough guess/.test(f.message)));
  assert.ok(!findings.some((f) => f.code === "caps-lost"), "the fixed file's capitals cover its words");
});

test("a bundle survives being written and read back, entry for entry", async () => {
  const entries = readBundle(fixture("sample.probundle"));
  const again = readBundle(await writeBundle(entries));
  assert.deepEqual(again.map((e) => e.name), entries.map((e) => e.name));
  again.forEach((e, i) => assert.ok(e.data.equals(entries[i].data)));
});

test("an entry larger than the caller allows is refused before it is inflated", () => {
  assert.throws(() => readBundle(fixture("sample.probundle"), { maxEntryBytes: 100 }), /larger than 100 bytes/);
});

test("a truncated bundle is an error, not a short read", () => {
  const b = fixture("sample.probundle");
  assert.throws(() => readBundle(b.subarray(0, 200)), /runs past the end/);
});
