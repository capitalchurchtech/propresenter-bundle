import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePresentation, readBundle, checkPresentationBytes } from "../src/index.js";
import {
  parseScript, chunkSpeech, cueLabel, cuesOf, withTitleSlides, fromScreenplay, vistaNote, hexToRgb,
  makeScriptType, composeScriptPresentation, buildScriptBundle, readPayload, playScript, checklist, questions, LABEL_SWATCHES,
} from "../src/script/index.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const recipe = JSON.parse(fs.readFileSync(path.join(FIX, "show-recipe.json"), "utf8"));
const typeWith = (over = {}) => {
  const { doc, schema } = decodePresentation(fs.readFileSync(path.join(FIX, "show-template.pro")));
  return makeScriptType({ ...recipe, ...over }, doc, schema);
};
const strip = (beats) => beats.map(({ id, ...b }) => b);
const labelOf = (cue) => cue.actions.find((a) => a.slide).label;
const macrosOf = (cue) => cue.actions.filter((a) => a.macro).map((a) => a.macro.identification.parameter_name);

// An invented script in the shapes writers paste: NAME: words, the name alone with words below, directions in
// brackets and asterisks, a tech note, files, and a title block before anyone speaks.
const SCRIPT = `THE BAKER AND THE BELL
LONG VERSE: Be kind to one another.
EPHESIANS 4:32
[Video plays on the background: the bakery at dawn]
BAKER: Good morning, everyone!
WREN: Morning!
[Music starts playing and the lights go into party mode]
BAKER:
 Let's bake.
Wren's Thoughts: I hope there is cake.
[PICTURE: cake.png]
[Video ends- background shows an image of the bakery]
{Lights: Up | Vista 12,3}
NARRATOR: And so the day began.
[The baker tracks the flour. It sounds fun.]
[RESET]`;

test("a script reads into lines, directions, headings and files, every word kept", () => {
  const { beats, cast } = parseScript(SCRIPT, { palette: recipe.palette });
  const kinds = beats.map((b) => b.kind);
  assert.deepEqual(kinds.slice(0, 3), ["heading", "heading", "heading"]);
  assert.deepEqual(strip(beats.slice(0, 3)).map((b) => b.speaker), ["Title", "Long Verse", "Long Verse"]);
  assert.ok(beats.some((b) => b.kind === "line" && b.speaker === "Baker" && b.text === "Let's bake."), "the name alone, its words on the next line");
  assert.ok(beats.some((b) => b.kind === "picture" && b.file === "cake.png"));
  assert.ok(beats.some((b) => b.kind === "lights" && b.text === "Lights: Up" && b.vista === "12,3"), "a tech note is a lights slide with its Vista number");
  assert.equal(beats.at(-1).kind, "reset");
  assert.deepEqual(cast.map((c) => c.label), ["Baker", "Wren", "Wren's Thoughts", "Narrator"]);
});

test("a speaker's thoughts share their colour; the narrator is black and outside the palette", () => {
  const { cast } = parseScript(SCRIPT, { palette: recipe.palette });
  const color = Object.fromEntries(cast.map((c) => [c.label, c.color]));
  assert.equal(color.Baker, "#0177cc");
  assert.equal(color.Wren, "#cc014e");
  assert.equal(color["Wren's Thoughts"], color.Wren);
  assert.equal(color.Narrator, "#000000");
});

test("soundboard cues: VIDEO and AUDIO warn the desk, lights are not a label, a video ending is a plain note", () => {
  const { beats } = parseScript(SCRIPT, { cueStyle: "soundboard" });
  const cues = beats.filter((b) => b.kind === "cue").map((b) => b.text);
  assert.deepEqual(cues, ["VIDEO", "AUDIO", "PICTURE"]);
  assert.equal(cueLabel("The lights dim slowly"), "", "lights alone: no cue slide");
  assert.equal(cueLabel("Video ends and the music swells"), "AUDIO");
  assert.equal(cueLabel("A video and a song"), "VIDEO + AUDIO");
});

test("cue style keeps every kind, alphabetical, as the first booth labelled them", () => {
  const { beats } = parseScript(SCRIPT, { cueStyle: "cue" });
  const cues = beats.filter((b) => b.kind === "cue").map((b) => b.text);
  assert.deepEqual(cues, ["VIDEO", "LIGHTS + MUSIC", "PICTURE + VIDEO"]);
  assert.deepEqual(cuesOf("the phone rings, then a record scratch"), ["MUSIC"]);
});

test("'sounds' and 'tracks' as verbs are not cues; a direction with its Vista number needs no cue", () => {
  assert.equal(cueLabel("The baker tracks the flour. It sounds fun."), "");
  const { beats } = parseScript("BAKER: Hi\n[Music starts, Vista 4,1]");
  assert.equal(beats.filter((b) => b.kind === "cue").length, 0);
  assert.equal(beats.find((b) => b.kind === "note").vista, "4,1");
});

test("long speech is packed into slides by sentence, never past the limit unless one sentence is", () => {
  const long = "One two three four five. ".repeat(20).trim();
  const chunks = chunkSpeech(long, 60);
  assert.ok(chunks.length > 1 && chunks.every((c) => c.length <= 60));
  assert.equal(chunks.join(" "), long);
  assert.deepEqual(chunkSpeech("x".repeat(80), 60), ["x".repeat(80)]);
});

test("the title slide opens, closes, and releases a gag three read slides later", () => {
  const beats = parseScript("A: one\n[PICTURE: gag.png]\nA: two\nA: three\nA: four\nA: five").beats;
  const out = withTitleSlides(beats, { file: "title.png" });
  const files = out.map((b) => (b.kind === "background" ? "T" : b.kind === "picture" ? "P" : "."));
  assert.equal(files.join(""), "T.P...T.T");
});

test("a screenplay's text reads as NAME: words and starred directions", () => {
  const text = [
    "BLACKOUT. A bell rings in the dark.",
    "                    BAKER",
    "          Good morning, town.",
    "                    WREN",
    "          Good morning, baker.",
    "A cart rolls past the window.",
    "                    BAKER",
    "          Bread for everyone!",
    "                    WREN",
    "          Hooray!",
  ].join("\n");
  const out = fromScreenplay(text);
  assert.match(out, /^\\\*BLACKOUT\. A bell rings in the dark\.\\\*$/m);
  assert.match(out, /^BAKER: Good morning, town\.$/m);
  assert.match(out, /^\\\*A cart rolls past the window\.\\\*$/m);
});

test("built slides copy the masters: labels, colours, macros by id, cue slides that hold, notes at 1 s", async () => {
  const { beats, cast } = parseScript(SCRIPT, { palette: recipe.palette });
  const type = typeWith();
  const { presentation: p } = composeScriptPresentation({ name: "The Baker and the Bell", beats, cast }, type);
  assert.equal(p.cues.length, beats.length);
  const firstLine = p.cues[beats.findIndex((b) => b.kind === "line")];
  assert.equal(labelOf(firstLine).text, "Baker");
  assert.equal(firstLine.name, undefined, "the master's sample cue name does not travel onto spoken slides");
  assert.equal(p.cues[beats.findIndex((b) => b.kind === "picture")].name, "cake.png", "a picture slide is named for its file");
  assert.deepEqual(labelOf(firstLine).color, hexToRgb("#0177cc"));
  // Macros are the workspace's own, by id: never renumbered.
  const ids = p.cues.flatMap((c) => c.actions.filter((a) => a.macro).map((a) => a.macro.identification.parameter_uuid.string));
  assert.ok(ids.length && ids.every((s) => /^00000000-0000-4000-9000-00000000AAA[123]$/.test(s)));
  // The script macro on the first slide and the first after a picture; the slide macro on the picture.
  assert.deepEqual(macrosOf(p.cues[0]), ["Show Script"]);
  const gag = beats.findIndex((b) => b.kind === "picture");
  assert.deepEqual(macrosOf(p.cues[gag]), ["Show Slide"]);
  assert.deepEqual(macrosOf(p.cues[gag + 1]), ["Show Script"]);
  // A soundboard cue slide: its words as the label, in the booth's video colour, holding for the operator.
  const cue = p.cues[beats.findIndex((b) => b.kind === "cue")];
  assert.equal(labelOf(cue).text, "VIDEO");
  assert.ok(labelOf(cue).color.red > 0.6);
  assert.equal(cue.completion_action_type, 1);
  // Scene Notes play on after the recipe's 1 s, not the master's 0.2 s.
  const note = p.cues[beats.findIndex((b) => b.kind === "note")];
  assert.equal(note.completion_action_type, 3);
  assert.equal(note.completion_time, 1);
  // The tech note's Vista number is in the slide's notes.
  const lights = p.cues[beats.findIndex((b) => b.kind === "lights")];
  assert.match(Buffer.from(lights.actions.find((a) => a.slide).slide.presentation.notes.rtf_data).toString("latin1"), /Vista:12,3/);
});

test("cue style labels CUE: and keeps the template's own note timing", () => {
  const { beats, cast } = parseScript(SCRIPT, { cueStyle: "cue" });
  const { presentation: p } = composeScriptPresentation({ name: "x", beats, cast }, typeWith({ cueStyle: "cue", noteAdvanceSeconds: null }));
  assert.equal(labelOf(p.cues[beats.findIndex((b) => b.kind === "cue")]).text, "CUE: VIDEO");
  assert.equal(p.cues[beats.findIndex((b) => b.kind === "note")].completion_time, 0.2);
});

test("the bundle holds the presentation and attached pictures under the booth's workspace, and reads back clean", async () => {
  const { beats, cast } = parseScript(SCRIPT);
  const media = new Map([["cake.png", { data: fs.readFileSync(path.join(FIX, "dot.png")), w: 2, h: 2, format: "png" }]]);
  const built = await buildScriptBundle({ name: "The Baker and the Bell", beats, cast, media, titleSlide: { file: "title.png", extras: ["Welcome", "Close"] } }, typeWith());
  const entries = readBundle(built.buffer);
  assert.deepEqual(entries.map((e) => e.name), ["The Baker and the Bell.pro", `${recipe.workspace}/Media/Assets/cake.png`]);
  const pro = entries[0].data;
  assert.equal(checkPresentationBytes(pro).ok, true);
  const { doc } = decodePresentation(pro);
  assert.deepEqual(doc.cue_groups.map((g) => g.group.name), ["The Baker and the Bell", "Title"]);
  assert.deepEqual(doc.cue_groups[1].cue_identifiers.map((id) => labelOf(doc.cues.find((c) => c.uuid.string === id.string)).text), ["Title Slide: Welcome", "Title Slide: Close"]);
  assert.equal(built.count, beats.length + 2);
});

test("a recipe that names a master the template lacks, or no workspace, is refused with a reason", () => {
  assert.throws(() => typeWith({ masters: { ...recipe.masters, speaker: "00000000-0000-4000-8000-0000DEADBEEF" } }), /no speaker slide/);
  assert.throws(() => typeWith({ workspace: "" }), /no workspace/);
});

test("the payload keeps only known fields and kinds, and cleans file names", () => {
  const types = [{ key: "example-show", label: "Example Show" }];
  const p = readPayload({ beats: [{ kind: "picture", file: "../../etc/x.png", secret: 1 }, { kind: "bogus", text: "hi" }], cast: [{ label: "A", color: "#000000" }] }, types);
  assert.equal(p.type, "example-show");
  assert.equal(p.beats[0].file, "-..-etc-x.png", "no folders, and no leading dots");
  assert.equal(p.beats[0].secret, undefined);
  assert.equal(p.beats[1].kind, "note");
  assert.match(readPayload({ beats: [{ kind: "line" }], type: "nope" }, types).error, /Unknown kind of show/);
  assert.match(readPayload({ beats: [] }, types).error, /no slides/);
});

test("the review reads as a script, lists what the booth checks, and asks before building", () => {
  const { beats, cast } = parseScript(SCRIPT);
  const text = playScript(beats);
  assert.match(text, /BAKER\n\s+Good morning, everyone!/);
  assert.match(text, />> AUDIO \(cue slide: holds for the operator\)/);
  const c = checklist(beats, recipe);
  assert.deepEqual(c.sound.map((s) => s.what), ["VIDEO", "AUDIO"]);
  assert.equal(c.lights.length, 1);
  assert.equal(c.lights[0].fireOn, c.lights[0].slide + 1, "lights fire on the AUDIO slide after their direction");
  assert.ok(c.pictures.some((p) => p.file === "cake.png"));
  assert.equal(c.gags.length, 1);
  assert.equal(c.timing.noteAdvanceSeconds, 1);
  const q = questions(cast);
  assert.deepEqual(q.map((x) => x.id), ["colors", "reused"]);
  assert.equal(q[0].swatches, LABEL_SWATCHES);
  assert.equal(vistaNote(" vista 1 , 2"), "Vista:1,2");
});
