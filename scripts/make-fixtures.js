// Builds the test fixtures from invented words, so no church's real file is ever in this repo.
//
//   node scripts/make-fixtures.js [out-dir]
//
// Writes, under test/fixtures/:
//   sample.pro          two groups, five slides: title, subtitle, description, link, QR, a caps box,
//                       a macro, a background, and one field the schema does not know
//   sample-fixed.pro    the same after a pretend operator's hand fixes, for the diff test
//   sample.probundle    sample.pro and its media, with one picture left out
//   sample.protheme     a theme with two theme slides, untidy box names, and its picture in Assets
//   dot.png             a 2x2 picture the slides point at
//   show-template.pro   a show template for the script builder: one master of each kind a booth builds,
//                       with its macros by id
//   show-recipe.json    the recipe naming those masters
//
// Deterministic: the same bytes every run, so a change to the output is a change to this script.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";
import { loadSchema } from "../src/schema.js";
import { writeRangeFont } from "../src/rtf.js";
import { writeBundle } from "../src/bundle.js";

const OUT = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../test/fixtures");
const WORKSPACE = "/Users/example/Library/Application Support/RenewedVision/ProPresenter/UserWorkspaces/Example";

let n = 0;
const id = () => ({ string: `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, "0").toUpperCase()}` });

const rtf = (font, halfPoints, words) => Buffer.from(
  `{\\rtf1\\ansi\\ansicpg1252\\cocoartf2870\n\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fnil\\fcharset0 ${font};}\n` +
  `{\\colortbl;\\red255\\green255\\blue255;\\red255\\green255\\blue255;}\n\\pard\\pardeftab1680\\partightenfactor0\n\n\\f0\\fs${halfPoints} \\cf2 ${words}}`, "latin1");

function text(name, font, family, size, words, [x, y, w, h], extra = {}) {
  return {
    element: {
      uuid: id(), name,
      bounds: { origin: { x, y }, size: { width: w, height: h } },
      text: {
        rtf_data: rtf(font, size * 2, words),
        attributes: {
          font: { name: font, size, family },
          custom_attributes: [
            ...(extra.caps ? [{ range: { end: extra.capsEnd ?? words.length }, capitalization: 1 }] : []),
            { range: { end: words.length }, _unknown_12: [writeRangeFont({ name: font, size, bold: false, family })] },
          ],
          ...(extra.multiple ? { paragraph_style: { line_height_multiple: extra.multiple } } : {}),
        },
      },
    },
  };
}

const url = (file) => ({ absolute_string: "file://" + encodeURI(`${WORKSPACE}/Media/Assets/${file}`), platform: 1, local: { root: 10, path: `Media/Assets/${file}` } });
const image = (name, file, [x, y, w, h]) => ({
  element: { uuid: id(), name, bounds: { origin: { x, y }, size: { width: w, height: h } }, fill: { enable: true, media: { uuid: id(), url: url(file), image: { drawing: { natural_size: { width: 2, height: 2 } } } } } },
});
const background = (file) => ({ uuid: id(), isEnabled: true, type: 2, media: { element: { uuid: id(), url: url(file), image: { drawing: { natural_size: { width: 2, height: 2 } }, file: { local_url: url(file) } } }, layer_type: 1 } });
const macro = (name) => ({ uuid: id(), isEnabled: true, type: 23, macro: { identification: { parameter_uuid: { string: "00000000-0000-4000-9000-00000000AAAA" }, parameter_name: name, parent_collection: { parameter_uuid: { string: "00000000-0000-4000-9000-00000000BBBB" }, parameter_name: "Example Service" } } } });
const cue = (label, elements, more = []) => ({ uuid: id(), name: label, completion_action_type: 1, isEnabled: true, actions: [{ uuid: id(), label: { text: label }, isEnabled: true, type: 11, slide: { presentation: { base_slide: { elements } } } }, ...more] });

function build(fixed) {
  n = 0;
  const title = fixed
    ? text("Title", "HelveticaNeue-Medium", "Helvetica Neue", 80, "Harvest Supper", [122, 100, 1600, 180], { multiple: 0.8 })
    : text("Harvest Supper", "HelveticaNeue-Medium", "Helvetica Neue", 80, "Harvest Supper", [122, 120, 1600, 120]);
  const kicker = text("Subtitle", "Georgia-Italic", "Georgia", 50, "come hungry", [126, 60, 900, 63]);
  const desc = text("Description", "HelveticaNeue", "Helvetica Neue", 60, "Bring a dish to share and stay for the music in the hall after the second gathering.", [126, 300, 1100, 90]);
  const link = text("Link", "HelveticaNeue", "Helvetica Neue", 50, "example.org/supper", [126, 900, 800, 60]);
  const qr = image("QR code", "example-qr.png", [1500, 300, 300, 300]);
  const panel = image("Panel", "example-panel.png", [0, 0, 1920, 1080]);
  const speakerName = text("Name", "HelveticaNeue", "Helvetica Neue", 90, "Pat Example", [88, 800, 600, 110]);
  const speakerRole = text("Role", "HelveticaNeue-Light", "Helvetica Neue", 50, fixed ? "Volunteer Coordinator" : "Volunteer Coordinator", [88, 920, 500, 67], { caps: true, capsEnd: fixed ? 21 : 9 });

  const cues = [
    cue("Welcome", [text("Words", "HelveticaNeue", "Helvetica Neue", 80, "Welcome, everyone", [200, 400, 1500, 200])], [background("example-bg.png")]),
    cue("Speaker Intro", [speakerName, speakerRole], fixed ? [macro("Lower Thirds")] : [background("example-bg.png"), macro("Lower Thirds")]),
    cue("Harvest Supper", fixed ? [title, kicker, desc, link, qr, panel] : [qr, link, desc, kicker, title, panel], [background("example-bg.png")]),
    cue("Blank", []),
  ];
  if (fixed) cues.push(cue("Thank You", [text("Words", "HelveticaNeue", "Helvetica Neue", 80, "Thank you", [200, 400, 1500, 200])]));
  const g1 = { group: { uuid: id(), name: "Opening", color: { red: 0.2, green: 0.4, blue: 0.8, alpha: 1 } }, cue_identifiers: [cues[0].uuid, cues[1].uuid] };
  const g2 = { group: { uuid: id(), name: "Announcements", color: { red: 0.5, green: 0.6, blue: 0.3, alpha: 1 } }, cue_identifiers: cues.slice(2).map((c) => c.uuid) };
  return {
    uuid: id(), name: "Example Sunday",
    application_info: { platform: 1, application: 1 },
    cues, cue_groups: [g1, g2],
    arrangements: [{ uuid: id(), name: "Full", group_identifiers: [g1.group.uuid, g2.group.uuid] }],
  };
}

function encode(obj) {
  const { Presentation } = loadSchema();
  return Buffer.from(Presentation.encode(Presentation.fromObject(obj)).finish());
}

/** A field the schema does not define (number 9001, a varint), as a newer ProPresenter might add. */
function withUnknownField(buf) {
  const w = protobuf.Writer.create();
  w.uint32((9001 << 3) | 0).uint32(7);
  return Buffer.concat([buf, Buffer.from(w.finish())]);
}

/** A 2x2 PNG of one colour, made here so no picture of anything real is involved. */
function png(r, g, b) {
  const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]);
  const row = Buffer.from([0, r, g, b, r, g, b]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat([row, row]), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** A fixed timestamp inside a zip, so the bytes do not change from run to run. */
function fixedTimes(zip) {
  for (let p = 0; p + 30 <= zip.length;) {
    const sig = zip.readUInt32LE(p);
    if (sig === 0x04034b50) { zip.writeUInt32LE(0x5b210000, p + 10); p += 30 + zip.readUInt16LE(p + 26) + zip.readUInt16LE(p + 28) + zip.readUInt32LE(p + 18); }
    else if (sig === 0x02014b50) { zip.writeUInt32LE(0x5b210000, p + 12); p += 46 + zip.readUInt16LE(p + 28) + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32); }
    else break;
  }
  return zip;
}

// A theme, the way ProPresenter exports one: <name>/Theme beside <name>/Assets/. Two theme slides with the
// untidy box names real themes collect ("Text" twice, a box named after the words it once held), and a
// background picture in the theme's own Assets.
function theme() {
  n = 0x2000;
  const assets = "/Users/example/Library/Application Support/RenewedVision/ProPresenter/Themes/Example Theme/Assets";
  const bg = { element: { uuid: id(), name: "Background", bounds: { origin: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }, fill: { enable: true, media: { uuid: id(), url: { absolute_string: "file://" + encodeURI(`${assets}/example-bg.png`), platform: 1, local: { root: 12, path: "Assets/example-bg.png" } }, image: { drawing: { natural_size: { width: 2, height: 2 } } } } } } };
  const slide = (name, elements) => ({ name, base_slide: { uuid: id(), size: { width: 1920, height: 1080 }, elements } });
  const doc = {
    application_info: { platform: 1, application: 1 },
    slides: [
      slide("Verse", [bg, text("Text", "HelveticaNeue", "Helvetica Neue", 60, "Verse words", [160, 300, 1600, 400]), text("Text", "HelveticaNeue-Light", "Helvetica Neue", 40, "Reference", [160, 760, 800, 60])]),
      slide("Quote", [text("Every good thing takes time", "Georgia-Italic", "Georgia", 70, "Quote words", [160, 300, 1600, 400])]),
    ],
  };
  const { ThemeDocument } = loadSchema();
  return [
    { name: "Example Theme/Theme", data: Buffer.from(ThemeDocument.encode(ThemeDocument.fromObject(doc)).finish()) },
    { name: "Example Theme/Assets/example-bg.png", data: png(10, 20, 30) },
  ];
}

// A show's template for the script builder: one master of each kind a booth builds (speaker, Scene Notes,
// picture, background, lights, sound, video, reset), with the two macros by id, and a recipe naming them.
function showTemplate() {
  n = 0x1000;
  const macroRef = (name, uuidTail) => ({ uuid: id(), isEnabled: true, type: 23, macro: { identification: { parameter_uuid: { string: `00000000-0000-4000-9000-${uuidTail}` }, parameter_name: name, parent_collection: { parameter_uuid: { string: "00000000-0000-4000-9000-00000000CCCC" }, parameter_name: "Example Shows" } } } });
  const words = (w) => [text("Words", "HelveticaNeue", "Helvetica Neue", 80, w, [100, 100, 1720, 880])];
  const mediaAction = (file, kind) => ({
    uuid: id(), isEnabled: true, type: 2,
    media: { element: { uuid: id(), url: url(file), ...(kind === "image"
      ? { image: { drawing: { natural_size: { width: 2, height: 2 } }, file: { local_url: url(file) } } }
      : { [kind]: { file: { local_url: url(file) }, transport: { play_rate: 1, out_point: 9, end_point: 9 } } }) }, layer_type: kind === "audio" ? 2 : 0 },
  });
  const show = (label, elements, more = [], extra = {}) => Object.assign(cue(label, elements, more), extra);
  const masters = {
    speaker: show("Speaker 1", words("A line someone says"), [macroRef("Show Script", "00000000AAA1")]),
    note: show("Scene Notes", words("A stage direction"), [], { completion_action_type: 3, completion_target_type: 1, completion_time: 0.2 }),
    picture: show("Scene Notes", [], [mediaAction("example-gag.png", "image"), macroRef("Show Slide", "00000000AAA2")]),
    background: show("Title Slide", words("Example Show"), [mediaAction("example-bg.png", "image")]),
    lights: show("AUTO ADVANCES", words("Lights: up"), [], { completion_action_type: 3, completion_target_type: 1, completion_time: 6.5 }),
    audio: show("Scene Notes", words("A sound plays"), [mediaAction("example-sound.mp3", "audio")], { completion_action_type: 3, completion_target_type: 1, completion_time: 0.5 }),
    video: show("Video", [], [mediaAction("example-clip.mp4", "video")]),
    reset: show("RESET", [], [macroRef("Show Reset", "00000000AAA3")]),
  };
  masters.video.actions[0].label.color = { red: 0.7, green: 0.05, blue: 0.27, alpha: 1 };
  const cues = Object.values(masters);
  const group = { group: { uuid: id(), name: "Example Show", color: { red: 0.1, green: 0.3, blue: 0.8, alpha: 1 } }, cue_identifiers: cues.map((c) => c.uuid) };
  const template = { uuid: id(), name: "Example Show", application_info: { platform: 1, application: 1 }, cues, cue_groups: [group] };
  const recipe = {
    key: "example-show", label: "Example Show", palette: ["#0177cc", "#cc014e", "#23b44c"], reset: true, video: true,
    cueStyle: "soundboard", noteAdvanceSeconds: 1, lineLimit: 190, titleLabel: "Title Slide", titleGroup: "Title",
    titleExtras: ["Welcome", "Intermission", "Close"], workspace: WORKSPACE,
    masters: Object.fromEntries(Object.entries(masters).map(([k, c]) => [k, c.uuid.string])),
  };
  return { template: encode(template), recipe };
}

const sample = withUnknownField(encode(build(false)));
const fixed = encode(build(true));
const dot = png(40, 120, 90);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "sample.pro"), sample);
fs.writeFileSync(path.join(OUT, "sample-fixed.pro"), fixed);
fs.writeFileSync(path.join(OUT, "dot.png"), dot);
const show = showTemplate();
fs.writeFileSync(path.join(OUT, "show-template.pro"), show.template);
fs.writeFileSync(path.join(OUT, "show-recipe.json"), JSON.stringify(show.recipe, null, 1) + "\n");
// The bundle leaves example-panel.png out, so the missing-media check has something to find.
const bundle = await writeBundle([
  { name: "Example Sunday.pro", data: sample },
  { name: `${WORKSPACE}/Media/Assets/example-qr.png`, data: dot },
  { name: `${WORKSPACE}/Media/Assets/example-bg.png`, data: png(10, 20, 30) },
]);
fs.writeFileSync(path.join(OUT, "sample.probundle"), fixedTimes(bundle));
fs.writeFileSync(path.join(OUT, "sample.protheme"), fixedTimes(await writeBundle(theme())));
console.log(`fixtures: sample.pro ${sample.length} B, sample-fixed.pro ${fixed.length} B, sample.probundle ${bundle.length} B`);
