// A script's beats as a ProPresenter bundle: one presentation, one slide for each thing said, each stage
// direction, each gag picture and each change of background, in script order.
//
// WHAT IS COPIED, NOT DRAWN. Every slide is a copy of one the booth already built in its own show (the
// "masters", named by the church's recipe): a speaker slide, a Scene Notes slide, a full-screen picture, the
// background, a lights slide, and optionally a sound, a video and a RESET slide. Their fonts, colours,
// positions, timing and macros are the booth's by construction; only the words, the label, the colour of the
// label and the picture are replaced.
//
// THE TWO MACROS, as booths place them: the picture master's macro on every slide that puts a picture on the
// screens (a gag or the background); the speaker master's macro on the first slide of the show and on the
// first slide after a picture, which takes the picture down and puts the script back. Each beat can override
// that ("none", or the other one). The macros point at the workspace's own BY ID and are copied as they are:
// renumbering a macro's id makes it silently do nothing.
//
// THE NOTES. A lights cue is a line in the slide's notes, "Vista:139,1", which the lighting desk reads off the
// presentation. Any beat can carry one.
import fs from "node:fs";
import path from "node:path";
import { decodePresentation, encodePresentation } from "../schema.js";
import { writeBundle } from "../bundle.js";
import { createGeometry, linePitch, LINE_PADDING } from "../geometry.js";
import { fallbackMetrics, tableMetrics } from "../metrics.js";
import { uuid, freshCopy, setText, mediaUrl } from "../elements.js";
import { hexToRgb, lengthSeconds, vistaNote, CUE_STYLES } from "./parse.js";

/**
 * @typedef {object} Recipe  one kind of show, as a church's pack describes it (recipe.json beside template.pro)
 * @property {string} key                 e.g. "family-service"
 * @property {string} label               e.g. "Skit"
 * @property {Record<string, string>} masters  slide uuids in template.pro: speaker, note, picture, background,
 *                                        lights (required); audio, video, reset (when the booth built one)
 * @property {string} workspace           the absolute path of the booth's ProPresenter workspace, for media URLs
 * @property {string[]} [palette]         the cast's colours, in order
 * @property {boolean} [reset]            end the show with the RESET slide
 * @property {"soundboard"|"cue"} [cueStyle]  what a cue slide is called (parse.js)
 * @property {number|null} [noteAdvanceSeconds]  how long a Scene Notes slide stays before playing on; null keeps the master's
 * @property {number} [lineLimit]         longest a spoken slide is left
 * @property {string} [titleLabel]        the title slide's label ("Title Slide")
 * @property {string} [titleGroup]        the group the extra title slides go in ("Title")
 * @property {string[]} [titleExtras]     the extra title slides' names (Welcome, Intermission, Close)
 */
/** @typedef {{ data: Buffer, w?: number, h?: number, format?: string }} Media */
/**
 * @typedef {object} ScriptInput
 * @property {string} name
 * @property {import("./parse.js").Beat[]} beats
 * @property {import("./parse.js").Cast[]} cast
 * @property {Map<string, Media>} [media]  pictures the writer attached, by the file name the beat names
 * @property {{ file: string, extras: string[] }} [titleSlide]  the title slide again, past the end of the show, one
 *   copy for each name in its own group, for the operator to welcome people in, hold intermission and close
 */

// The slide's notes, as ProPresenter writes them: Helvetica Neue 48 on white.
const NOTES_RTF = (text) =>
  "{\\rtf1\\ansi\\ansicpg1252\\cocoartf2868\n\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;}\n" +
  "{\\colortbl;\\red255\\green255\\blue255;\\red255\\green255\\blue255;}\n{\\*\\expandedcolortbl;;\\csgray\\c100000;}\n" +
  "\\deftab1300\n\\pard\\pardeftab1300\\pardirnatural\\partightenfactor0\n\n\\f0\\fs48 \\cf2 " + text.replace(/[\\{}]/g, "\\$&") + "}";

// A cue that holds until the operator plays on, which is how speaker slides are set: completion "last"
// (ProPresenter's own name for "do nothing"), no target and no time.
const COMPLETION_ACTION_LAST = 1;
const COMPLETION_AFTER_TIME = 3;
function holds(cue) {
  cue.isEnabled = true;
  cue.completion_action_type = COMPLETION_ACTION_LAST;
  delete cue.completion_target_type;
  delete cue.completion_time;
}

const slideOf = (cue) => cue.actions.find((a) => a.slide);
const elementsOf = (cue) => slideOf(cue)?.slide?.presentation?.base_slide?.elements ?? [];
const macroOf = (cue) => cue.actions.find((a) => a.macro);

/**
 * The largest size, up to the box's own, at which the words fit the box. ProPresenter is set to shrink a box's
 * words to fit, but it keeps the shrink it last worked out for the OLD words, so the size is chosen here.
 */
export function fitSize(text, designed, width, height, multiple = 1, geometry = createGeometry()) {
  const fits = (s) => geometry.wrapRuns([{ text, bold: false }], s, width * 0.94 - LINE_PADDING * 2).length * linePitch(s, multiple) <= height * 0.94;
  if (fits(designed)) return designed;
  let lo = 14, hi = designed; // lo is the floor, whether or not it fits; hi does not fit
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

const IMAGE_FORMAT = { jpg: "JPG", jpeg: "JPG", png: "png", gif: "gif", heic: "HEIC", webp: "webp" };
/** How ProPresenter names a picture's format, from its file name. */
export const imageFormat = (file) => IMAGE_FORMAT[file.split(".").pop()?.toLowerCase() ?? ""] ?? "JPG";
// How ProPresenter names a clip's codec: a guess from the extension; it reads the real one when the file is there.
export const CODEC = { mp4: "h264", m4v: "h264", mov: "h264", mp3: "mp3float", m4a: "aac", aac: "aac", wav: "pcm_s16le", aif: "pcm_s16be", aiff: "pcm_s16be" };

/**
 * One kind of show from a church's pack: the folder holds template.pro (the booth's own presentation) and
 * recipe.json, and the pack folder above it may hold metrics.json (advance widths of its fonts, for fitting).
 * @param {string} dir
 */
export function loadScriptType(dir) {
  const recipe = JSON.parse(fs.readFileSync(path.join(dir, "recipe.json"), "utf8"));
  const { doc: template, schema } = decodePresentation(fs.readFileSync(path.join(dir, "template.pro")));
  const metricsFile = [path.join(dir, "metrics.json"), path.join(dir, "..", "metrics.json")].find((f) => fs.existsSync(f));
  const metrics = metricsFile ? tableMetrics(JSON.parse(fs.readFileSync(metricsFile, "utf8"))) : fallbackMetrics;
  return makeScriptType(recipe, template, schema, metrics);
}

/** The same from objects already in hand (a test, or a pack read some other way). */
export function makeScriptType(recipe, template, schema, metrics = fallbackMetrics) {
  if (recipe.cueStyle && !CUE_STYLES.includes(recipe.cueStyle)) throw new Error(`cueStyle "${recipe.cueStyle}" is not one of ${CUE_STYLES.join(", ")}`);
  if (!recipe.workspace) throw new Error(`the ${recipe.label ?? recipe.key} recipe names no workspace (the booth's ProPresenter workspace path)`);
  const byId = new Map(template.cues.map((c) => [c.uuid.string, c]));
  const get = (k, required) => {
    const id = recipe.masters?.[k];
    if (!id) { if (required) throw new Error(`the ${recipe.label ?? recipe.key} recipe names no ${k} slide`); return undefined; }
    const c = byId.get(id);
    if (!c) throw new Error(`the ${recipe.label ?? recipe.key} template has no ${k} slide (${id})`);
    return c;
  };
  const masters = {
    speaker: get("speaker", true), note: get("note", true), picture: get("picture", true), background: get("background", true), lights: get("lights", true),
    audio: get("audio", false), video: get("video", false), reset: get("reset", false),
  };
  if (!macroOf(masters.speaker) || !macroOf(masters.picture)) throw new Error(`the ${recipe.label ?? recipe.key} template's speaker and picture slides must each carry a macro`);
  return { recipe, template, schema, masters, geometry: createGeometry({ metrics }) };
}

/**
 * The cues for a script, and every picture the writer attached.
 * @param {ScriptInput} input @param {ReturnType<typeof makeScriptType>} type
 */
export function composeScript(input, type) {
  const { recipe, masters, geometry } = type;
  const typeLabel = recipe.label ?? recipe.key ?? "this show";
  const colors = new Map(input.cast.map((c) => [c.label, hexToRgb(c.color)]));
  const scriptMacro = macroOf(masters.speaker);
  const slideMacro = macroOf(masters.picture);
  const media = input.media ?? new Map();
  const url = (file) => mediaUrl(file, recipe.workspace);
  // A soundboard cue slide wears the booth's own video label colour, so the sound desk sees it coming.
  const soundColor = slideOf(masters.video ?? masters.audio ?? masters.note)?.label?.color;

  const fillText = (cue, text) => {
    const el = elementsOf(cue)[0];
    if (!el) return;
    const b = el.element.bounds.size;
    const designed = el.element.text.attributes?.font?.size ?? 40;
    const multiple = el.element.text.attributes?.paragraph_style?.line_height_multiple || 1;
    setText(el, [{ text, bold: false }], fitSize(text, designed, b.width, b.height, multiple, geometry));
  };
  const setNotes = (cue, vista) => {
    const note = vistaNote(vista);
    if (note) slideOf(cue).slide.presentation.notes = { rtf_data: Buffer.from(NOTES_RTF(note), "latin1"), attributes: {} };
  };
  const pointAtPicture = (cue, file, m) => {
    const el = cue.actions.find((a) => a.media).media.element;
    el.uuid = uuid();
    el.url = url(file);
    el.metadata = { ...(el.metadata ?? {}), format: m?.format ?? imageFormat(file) };
    el.image = el.image ?? {};
    // Without the file in hand its size is a guess; ProPresenter reads the real one when it loads.
    el.image.drawing = { ...(el.image.drawing ?? {}), natural_size: { width: m?.w ?? 1920, height: m?.h ?? 1080 } };
    el.image.file = { local_url: url(file) };
  };
  // The media action carries the clip's length three times (the action, and the transport's out and end points);
  // with no length given they are left out rather than keep the sample clip's.
  const pointAtTimed = (action, kind, file, length) => {
    const el = action.media.element;
    el.uuid = uuid();
    el.url = url(file);
    const meta = { ...(el.metadata ?? {}) };
    delete meta.artist; // the sample's artist tag is not this file's
    el.metadata = { ...meta, format: CODEC[file.split(".").pop()?.toLowerCase() ?? ""] ?? meta.format };
    const body = el[kind];
    body.file = { local_url: url(file) };
    if (kind === "video") body.drawing = { ...(body.drawing ?? {}), natural_size: { width: 1920, height: 1080 } };
    const secs = lengthSeconds(length);
    if (secs) { action.duration = secs; body.transport.out_point = secs; body.transport.end_point = secs; }
    else { delete action.duration; delete body.transport.out_point; delete body.transport.end_point; }
  };

  const cues = [];
  const files = new Map();
  let afterPicture = true; // the show's first slide counts, so it sets the screens up
  for (const beat of input.beats) {
    let cue;
    // Anything that fills the screens, which the picture macro has to hand over to.
    const isPicture = beat.kind === "picture" || beat.kind === "background" || beat.kind === "video";
    if (beat.kind === "line" || beat.kind === "heading") {
      cue = freshCopy(masters.speaker);
      const action = slideOf(cue);
      // A heading ("Title", "Long Verse") is nobody's line, so its label has no colour.
      const color = beat.kind === "line" ? colors.get(beat.speaker ?? "") : undefined;
      action.label = { text: beat.speaker ?? "", ...(color ? { color } : {}) };
      fillText(cue, beat.text);
    } else if (beat.kind === "lights") {
      // The booth's own lights slide, whole (with its own advance time); its words are what the operator reads,
      // its Vista number goes in the notes below.
      cue = freshCopy(masters.lights);
      if (beat.text.trim()) fillText(cue, beat.text);
      else slideOf(cue).slide.presentation.base_slide.elements = [];
    } else if (beat.kind === "reset") {
      if (!masters.reset) throw new Error(`${typeLabel} has no reset slide in its template`);
      cue = freshCopy(masters.reset);
    } else if (beat.kind === "note" || beat.kind === "cue") {
      cue = freshCopy(masters.note);
      // A cue slide is only its label, nothing on screen, and HOLDS until someone plays on: that is where the
      // operator stops to cue it. Soundboard rooms call it what the desk does (AUDIO, in the video colour);
      // others "CUE: ...".
      if (beat.kind === "cue") {
        const text = beat.text.trim() || "CUE";
        slideOf(cue).label = recipe.cueStyle === "cue" ? { text: `CUE: ${text}` } : { text, ...(soundColor ? { color: soundColor } : {}) };
        holds(cue);
      } else if (recipe.noteAdvanceSeconds != null && cue.completion_action_type === COMPLETION_AFTER_TIME) {
        cue.completion_time = recipe.noteAdvanceSeconds;
      }
      if (beat.kind !== "cue" && beat.text.trim()) fillText(cue, beat.text);
      else slideOf(cue).slide.presentation.base_slide.elements = [];
    } else if (beat.kind === "audio") {
      // The booth's own sound slide, whole, with the sound on it and its own advance. Its words are the
      // direction the operator reads as the sound plays.
      const file = (beat.file ?? "").trim();
      if (!file) throw new Error("an audio slide needs a file name");
      if (!masters.audio) throw new Error(`${typeLabel} has no sound slide in its template`);
      cue = freshCopy(masters.audio);
      cue.name = file;
      if (beat.text.trim()) fillText(cue, beat.text);
      else slideOf(cue).slide.presentation.base_slide.elements = [];
      pointAtTimed(cue.actions.find((a) => a.media), "audio", file, beat.length);
    } else if (beat.kind === "video") {
      const file = (beat.file ?? "").trim();
      if (!file) throw new Error("a video slide needs a file name");
      if (!masters.video) throw new Error(`${typeLabel} has no video slide in its template`);
      cue = freshCopy(masters.video);
      cue.name = file; // the label stays the booth's
      pointAtTimed(cue.actions.find((a) => a.media), "video", file, beat.length);
    } else {
      const file = (beat.file ?? "").trim();
      if (!file) throw new Error(`a ${beat.kind} slide needs a file name`);
      cue = freshCopy(beat.kind === "picture" ? masters.picture : masters.background);
      // The labels stay the booth's own: the file is the cue's name, which the operator sees on hover.
      cue.name = file;
      // The background master's slide may carry its own show's words; only the media action matters here.
      if (beat.kind === "background") slideOf(cue).slide.presentation.base_slide.elements = [];
      const m = media.get(file);
      pointAtPicture(cue, file, m);
      if (m) files.set(file, m.data);
      if (beat.label) slideOf(cue).label = { ...slideOf(cue).label, text: beat.label };
    }
    // A master's own cue name is its sample's ("a master's cue name leaked onto every spoken slide"): text slides
    // carry none; media slides are named for their file above.
    if (!["audio", "video", "picture", "background"].includes(beat.kind)) delete cue.name;
    setNotes(cue, beat.vista);

    // The macro: the writer's choice, else by the rule in the header. A reset keeps its own, and starts the next
    // part of the show as a first slide.
    if (beat.kind === "reset") { afterPicture = true; cues.push(cue); continue; }
    const choice = beat.macro ?? "auto";
    const want = choice === "none" ? null : choice === "script" ? scriptMacro : choice === "slide" ? slideMacro
      : isPicture ? slideMacro : afterPicture ? scriptMacro : null;
    cue.actions = cue.actions.filter((a) => !a.macro);
    if (want) cue.actions.push({ ...freshCopy(want), uuid: uuid() });
    afterPicture = isPicture;
    cues.push(cue);
  }
  return { cues, files };
}

/**
 * The presentation, ready to encode, and every picture the writer attached.
 * @param {ScriptInput} input @param {ReturnType<typeof makeScriptType>} type
 */
export function composeScriptPresentation(input, type) {
  const { recipe, template } = type;
  const { cues, files } = composeScript(input, type);
  const pres = { ...template };
  pres.uuid = uuid();
  pres.name = input.name;
  // A group for the show, named for it, in the booth's own group shape (the first group of the file).
  const group = freshCopy(template.cue_groups[0]);
  group.group.name = input.name;
  group.cue_identifiers = cues.map((c) => c.uuid);
  pres.cues = cues;
  pres.cue_groups = [group];

  // The title slide again, past the end of the show, in its own group: the same picture and macro as the title
  // slide inside the show, one copy for each place the room has to be held.
  const file = input.titleSlide?.file?.trim();
  const extras = (input.titleSlide?.extras ?? []).map((e) => e.trim()).filter(Boolean);
  if (file && extras.length) {
    const label = recipe.titleLabel ?? "Title Slide";
    const copies = composeScript({ ...input, beats: extras.map((e, i) => ({ id: `title-${i}`, kind: "background", text: "", file, label: `${label}: ${e}` })) }, type);
    for (const [f, data] of copies.files) files.set(f, data);
    const title = freshCopy(group);
    title.group.name = recipe.titleGroup ?? "Title";
    title.cue_identifiers = copies.cues.map((c) => c.uuid);
    pres.cues = [...cues, ...copies.cues];
    pres.cue_groups = [group, title];
  }
  pres.arrangements = [];
  return { presentation: pres, files };
}

/**
 * The .probundle: the presentation at the root and each attached picture under the booth's workspace path.
 * @param {ScriptInput} input @param {ReturnType<typeof makeScriptType>} type
 * @returns {Promise<{ buffer: Buffer, count: number, presentation: any }>}
 */
export async function buildScriptBundle(input, type) {
  const { presentation, files } = composeScriptPresentation(input, type);
  const entries = [{ name: `${input.name}.pro`, data: encodePresentation(type.schema, presentation) }];
  for (const [f, data] of files) entries.push({ name: `${type.recipe.workspace}/Media/Assets/${f}`, data });
  return { buffer: await writeBundle(entries), count: presentation.cues.length, presentation };
}
