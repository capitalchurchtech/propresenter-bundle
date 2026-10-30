// A script pasted from a Google Doc or Word, read into the beats a show's slide deck is made of: one
// slide for each thing someone says, labelled with who says it; one "Scene Notes" slide for each stage
// direction; a full-screen picture for each gag; the picture behind everything when it changes; and lights
// cues written into the slide's notes for the lighting desk. Pure, with no imports beyond its sibling, so a
// page reads the paste in the browser and a server reads the same beats.
//
// THE SHAPE OF A SCRIPT (all of it as Google Docs hands it over, bold and escapes included):
//   BAKER: Okay everybody, are we ready?            a line; the name, a colon, the words
//   **WREN:**  then the words on the next line      the name alone, its words below
//   [Wren nods and writes everything down.]         a stage direction -> a Scene Notes slide
//   [LIGHTS 139,1 party mode]                        a lights cue for the desk
//   [PICTURE: kitchen.jpg]  [BACKGROUND: x.jpg]      a picture, by its file name in Media/Assets
//   [VIDEO: intro.mp4 1:54]  [AUDIO: entrance.mp3 2:56] a video or a sound, with its length if known
//   [RESET]                                          the closing RESET slide
//   {Lights: Up}                                     a tech note: production, not performance
// A direction that only SOUNDS like a light, a picture, a video or music ("the lights go into party mode")
// stays a direction, and a cue slide follows it so the operator sees the cue coming. What that cue slide is
// called depends on the room (`cueStyle`):
//   "soundboard"  VIDEO / AUDIO / PICTURE, joined with " + ". They warn the sound desk; lights are not a label,
//                 they ride as a Vista note on the gag or sound slide, so a lights-only direction gets no cue
//                 slide. A video ENDING is an ordinary Scene Note.
//   "cue"         "LIGHTS + MUSIC" style, every kind it mentions, alphabetical (the first booth's hand-made cues).
// The Vista number and the file are the writer's to say, not the parser's to guess.
// Before the first speaker, the title block becomes slides labelled "Title", and "LONG VERSE: ..." (with the
// reference under it) "Long Verse".

import { fromScreenplay } from "./screenplay.js";

/** @typedef {"line"|"heading"|"note"|"cue"|"lights"|"picture"|"background"|"video"|"audio"|"reset"} BeatKind */
/** @typedef {"auto"|"none"|"script"|"slide"} MacroChoice */
/**
 * @typedef {object} Beat
 * @property {string} id         stable within a page, so a picture stays with its row when rows move
 * @property {BeatKind} kind
 * @property {string} [speaker]  the label under the slide: a cast member for a line, free words for a heading
 * @property {string} text       what is said or the direction; for a cue, what it is ("AUDIO"). Empty for a picture
 * @property {string} [file]     a picture, background, video or sound: its file name in the workspace's Media/Assets
 * @property {string} [length]   a video or sound: how long it plays, "1:54" or seconds
 * @property {string} [label]    a picture, background or video's label, when it should not be the template's
 * @property {string} [vista]    what goes in the slide's notes after "Vista:", e.g. "139,1"
 * @property {MacroChoice} [macro]
 */
/** @typedef {{ label: string, color: string }} Cast */

export const BEAT_KINDS = ["line", "heading", "note", "cue", "lights", "picture", "background", "video", "audio", "reset"];
export const MACRO_CHOICES = ["auto", "none", "script", "slide"];
export const CUE_STYLES = ["soundboard", "cue"];

/** A neutral palette for a cast when the church gives none. Each church's own lives in its pack. */
export const DEFAULT_PALETTE = ["#0177cc", "#cc014e", "#23b44c", "#7600cc", "#cc298b", "#998f1f", "#cc2929", "#004a80"];
export const NARRATOR = /^narrator$/i;
export const NARRATOR_COLOR = "#000000";
/** Longest a spoken slide is left by default. The text shrinks to fit, but past this a line is a wall. */
export const LINE_LIMIT = 190;
/** The extra title slides, in their own group, by default: one to welcome people in, one for intermission, one to close. */
export const TITLE_EXTRAS = ["Welcome", "Intermission", "Close"];

// Words before a colon that are a heading in the script, not someone speaking.
const NOT_SPEAKERS = /^(long verse|short verse|verse|scripture|title|scene|setting|note|notes|cue|cues|props|characters|cast|time|length)$/i;

let counter = 0;
const newId = () => `b${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Markdown and Google Docs escapes off: **bold**, \! \[ \] and the like. */
export function clean(s) {
  return s
    .replace(/\\([\\`*_{}\[\]()#+\-.!|<>~])/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/[ ​]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** "BAKER" -> "Baker"; "WREN’S THOUGHTS" -> "Wren’s Thoughts". Already mixed case is left. */
export function nameCase(s) {
  const t = s.trim().replace(/\s+/g, " ");
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s(\-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

// "NAME:" at the start: one to five words, no digits, no sentence punctuation. "#1" is allowed so
// "TOWNSPERSON #1" is a speaker; other digits are not ("NIGHT 1: Opening" is a title). An actor may follow the
// name in brackets - "Jester (Sam): ..." - which is the label a booth uses.
const SPEAKER = /^([A-Za-z](?:[A-Za-z.’'&\- ]|#\d+){0,60}?(?:\s*\([A-Za-z][A-Za-z .’'-]{0,24}\))?)\s*:\s*(.*)$/;
/** The name without its (Actor). */
const baseName = (n) => n.replace(/\s*\([^)]*\)\s*$/, "").trim();

function speakerOf(line) {
  const m = SPEAKER.exec(line);
  if (!m) return null;
  // "NARRATOR (V.O.)" and "(O.S.)" are how a voice is heard, not who plays it: not part of the name.
  const name = m[1].trim().replace(/\s*\((?:V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT['’]?D)\)\s*$/i, "");
  const base = baseName(name);
  if (base.split(/\s+/).length > 6 || NOT_SPEAKERS.test(base)) return null;
  // A name is written in capitals or as a Capitalised Name; "so the plan is: ..." is a sentence.
  const words = base.replace(/[’']s\b/gi, "").split(/\s+/);
  const named = base === base.toUpperCase() || words.every((w) => /^[A-Z]/.test(w));
  return named ? { name, rest: m[2] } : null;
}

/**
 * Sentences packed into slides no longer than `limit`. A single long sentence is left whole.
 * @param {string} text @param {number} [limit]
 */
export function chunkSpeech(text, limit = LINE_LIMIT) {
  const t = text.trim();
  if (t.length <= limit) return t ? [t] : [];
  // Split on the space AFTER a sentence end, so only whitespace is ever dropped.
  const sentences = [];
  const end = /[.!?…]["”’')\]]*(\s+)/g;
  let last = 0, m;
  while ((m = end.exec(t))) { sentences.push(t.slice(last, m.index + m[0].length - m[1].length)); last = m.index + m[0].length; }
  if (last < t.length) sentences.push(t.slice(last));
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + 1 + s.length > limit) { out.push(cur); cur = ""; }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * What a direction mentions that a desk has to act on, in English. Each church can pass its own table (its
 * language, its words). "sound" and "track" are singular on purpose: as verbs ("it sounds fun", "she tracks the
 * mouse") they gave false cues.
 */
export const CUE_WORDS = {
  LIGHTS: /\blights?\b|\blighting\b|strobe|spotlight|blackout|black out|dim(s|med)?\b/i,
  MUSIC: /\b(music|audio|songs?|track|sound|record scratch|ring|phone rings?)\b/i,
  PICTURE: /\b(images?|pictures?|photos?)\b|background shows/i,
  VIDEO: /\b(videos?|films?|clips?)\b/i,
};
/** A video ENDING, which is an ordinary Scene Note in a soundboard room. */
export const VIDEO_ENDS = /\bvideo\s+(ends?|stops?|is over)\b|\bend of (the )?video\b/i;

/**
 * Every kind of cue a direction mentions, alphabetical: LIGHTS, MUSIC, PICTURE, VIDEO.
 * @param {string} t @param {Record<string, RegExp>} [words]
 */
export function cuesOf(t, words = CUE_WORDS) {
  return Object.keys(words).sort().filter((k) => words[k].test(t));
}

/**
 * The cue slide's words for a direction in a room's style, or "" for none. Soundboard: VIDEO, AUDIO, PICTURE
 * (lights ride as Vista notes, not labels; a video ending is no cue). Cue: every kind, "LIGHTS + MUSIC".
 * @param {string} t @param {"soundboard"|"cue"} [style] @param {Record<string, RegExp>} [words]
 */
export function cueLabel(t, style = "soundboard", words = CUE_WORDS) {
  const kinds = cuesOf(t, words);
  if (style === "cue") return kinds.join(" + ");
  const out = [];
  if (kinds.includes("VIDEO") && !VIDEO_ENDS.test(t)) out.push("VIDEO");
  if (kinds.includes("MUSIC")) out.push("AUDIO");
  if (kinds.includes("PICTURE")) out.push("PICTURE");
  return out.join(" + ");
}

const VISTA = /\bvista\s*[:\-]?\s*(\d+\s*,\s*\d+)/i;
const vistaValue = (s) => s.replace(/\s+/g, "");

/**
 * A direction's words as beats. `tech` is a note in {curly braces}: production, not performance. It never reads
 * as a Scene Note for the actors, and what is not a file or a reset becomes a lights slide with the words as
 * written ("Lights: Up"), its Vista number in the notes. A direction in [brackets] or *asterisks* is a Scene
 * Note, and when it only SOUNDS like a cue a cue slide follows it.
 */
function directionBeats(raw, starred, tech, opts) {
  const whole = clean(raw);
  // "Vista 139,1" may sit on any of them; it is lifted out first so the rest reads on its own.
  const v = VISTA.exec(whole);
  const t = v ? whole.replace(VISTA, "").replace(/[\s|,;\-]+$/g, "").replace(/^[\s|,;\-]+/, "").replace(/\s*\|\s*/g, " ").trim() : whole;
  const vista = v ? { vista: vistaValue(v[1]) } : {};
  if (/^reset$/i.test(t)) return [{ id: newId(), kind: "reset", text: "", ...vista }];
  const lights = /^lights?\s*[:\-]?\s*(\d+\s*,\s*\d+)\s*(.*)$/i.exec(t);
  if (lights) return [{ id: newId(), kind: "lights", text: lights[2].trim(), vista: vistaValue(lights[1]) }];
  const pic = /^(picture|image|photo|gag)\s*[:\-]\s*(\S.*)$/i.exec(t);
  if (pic) return [{ id: newId(), kind: "picture", text: "", file: pic[2].trim(), ...vista }];
  const bg = /^background\s*[:\-]\s*(\S.*)$/i.exec(t);
  if (bg) return [{ id: newId(), kind: "background", text: "", file: bg[1].trim(), ...vista }];
  // A video or a sound needs a file name WITH an extension: "Video: Wren talks about her plan" is a direction.
  const media = /^(video|audio)\s*[:\-]\s*(\S.*?\.[A-Za-z0-9]{2,4})(?:\s+(\d+:\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?))?$/i.exec(t);
  if (media) return [{ id: newId(), kind: media[1].toLowerCase(), text: "", file: media[2].trim(), ...(media[3] ? { length: media[3] } : {}), ...vista }];
  if (tech) return [{ id: newId(), kind: "lights", text: t, ...vista }];
  const note = { id: newId(), kind: "note", text: starred ? `*${t}*` : t, ...vista };
  // A direction that already carries its Vista number needs no reminder to find one.
  const label = v ? "" : cueLabel(t, opts.cueStyle, opts.cueWords);
  return label ? [note, { id: newId(), kind: "cue", text: label }] : [note];
}

// DIRECTIONS WRITTEN IN ASTERISKS, read off the raw line before the markup is stripped:
//   *\*Puppet pops out\**      italic with literal asterisks      \*Jester wipes eyes\*     literal asterisks only
//   ***Jester turns***         bold italic                         *Genesis 1-3*            italic
//   **Trainer waves**          bold, and only once someone is speaking: before that it is the title
// A whole paragraph like that is a direction. Inside a spoken line only the loud kinds are (literal
// asterisks, or bold italic), so "the most *serious* Jester" and "*(Angry Gritted Teeth)*" stay words.
const MARK = String.raw`(?:\\?\*)`;
const WHOLE = new RegExp(`^(${MARK}+)([\\s\\S]*?)(${MARK}+)$`);
// The literal asterisks must hug the words (`\*Puppet pops out\*`): "5 \* 3 \* 2" has a space inside each.
const INLINE = new RegExp(String.raw`(\*{0,3}\\\*\S(?:[^\n]*?\S)?\\\*\*{0,3}|\*\*\*[^*\n]+\*\*\*)`, "g");

/** The words of a line that is entirely a direction, and whether it was bold only; null for any other line. */
function wholeDirection(raw) {
  const m = WHOLE.exec(raw.replace(/[ ​]/g, " ").trim());
  if (!m) return null;
  // An opening marker hugs its words. "** This is going to be great. **" begins with the leftover close of the
  // line before it (the Google Docs export does this), and is speech.
  if (/^\s/.test(m[2])) return null;
  const text = clean(m[2]);
  if (!text) return null;
  // One wrapped span only: "**Never** give up, **ever**" begins and ends in bold but is words with two bold ones.
  if (/\*/.test(m[2])) return null;
  // **\[Music starts\]** is a bracketed direction in bold, and **{Lights: Up}** a tech note: the bracket rule reads those.
  if (/^(\[[^\]]*\]|\{[^}]*\})$/.test(text)) return null;
  // "**Jester:** Yes! ***Jester turns***" begins and ends in markers but is someone speaking. Not so when the
  // asterisks are literal: nobody speaks in those, whatever the first words are.
  if (speakerOf(text) && !m[1].includes("\\")) return null;
  // Bold only: exactly two asterisks to open, and none of them escaped or italic.
  const lead = m[1].replace(/\\/g, "").length;
  return { text, boldOnly: lead === 2 && !m[1].includes("\\") && !m[3].includes("\\") };
}

/** *emphasis* in spoken words is for the page, not the screen. */
const unItalic = (s) => s.replace(/(^|[^*])\*(\S(?:[^*\n]*\S)?)\*(?!\*)/g, "$1$2");

/** A line as pieces: words, directions (in square brackets, or in loud asterisks), and tech notes (in braces). */
function pieces(raw) {
  const out = [];
  raw.split(INLINE).forEach((chunk, i) => {
    if (i % 2 === 1) { const inner = clean(chunk.replace(/^(?:\\?\*)+/, "").replace(/(?:\\?\*)+$/, "")); if (inner) out.push({ text: inner, dir: true, starred: true }); return; }
    for (const part of clean(chunk).split(/(\[[^\]]*\]|\{[^}]*\})/g)) {
      const b = /^[[{]([^\]}]*)[\]}]$/.exec(part.trim());
      if (b) { if (b[1].trim()) out.push({ text: b[1], dir: true, starred: false, tech: part.trim().startsWith("{") }); }
      else if (part.trim()) out.push({ text: unItalic(part.trim()), dir: false, starred: false });
    }
  });
  return out;
}

/**
 * @typedef {object} TitleSlide
 * @property {string} file        its file name in the workspace's Media/Assets
 * @property {number} [after]     slides of script to wait after a picture or video before putting the room back (3)
 * @property {boolean} [bookend]  open and close the show with it (true)
 */
const SCREEN_TAKERS = ["picture", "video", "background"];
const READ_SLIDES = ["line", "heading", "note"];

/**
 * THE TITLE SLIDE, as a booth uses its own: it opens the show and closes it, and a few slides after any picture
 * or video has played it comes back, to release the gag and put the room right. "A few" is `after` slides of
 * script (spoken lines, headings, directions; tech notes and cues do not count). A gag followed by another
 * picture, video or background before then needs no release, and a show that ends first has its closing title
 * slide. The closing one goes before a trailing RESET, so the room is set right and then reset.
 * @param {Beat[]} beats @param {TitleSlide | undefined} title @param {string} [label]
 */
export function withTitleSlides(beats, title, label = "Title Slide") {
  const file = title?.file?.trim();
  if (!title || !file) return beats;
  const after = Math.max(1, Math.floor(title.after ?? 3));
  const bookend = title.bookend ?? true;
  const slide = () => ({ id: newId(), kind: "background", text: "", file, label });
  const out = [];
  let waiting = -1; // slides of script still to read before the release; -1 when nothing is waiting
  // The writer's own opening picture is the opening: a title slide stacked under it would be two in a row.
  if (bookend && beats[0]?.kind !== "background") out.push(slide());
  for (const b of beats) {
    if (b.kind === "reset") {
      const closing = bookend && b === beats.at(-1) && out.at(-1)?.file !== file;
      if (waiting >= 0 || closing) out.push(slide());
      waiting = -1;
      out.push(b);
      continue;
    }
    out.push(b);
    if (SCREEN_TAKERS.includes(b.kind)) { waiting = b.kind === "background" ? -1 : after; continue; }
    if (waiting > 0 && READ_SLIDES.includes(b.kind) && --waiting === 0) { out.push(slide()); waiting = -1; }
  }
  if (bookend && beats.at(-1)?.kind !== "reset" && !(out.at(-1)?.kind === "background" && out.at(-1)?.file === file)) out.push(slide());
  return out;
}

/**
 * @typedef {object} ParseOptions
 * @property {readonly string[]} [palette]   the cast's colours, in order
 * @property {boolean} [reset]               end the show with a RESET slide, unless the script already ends with one
 * @property {TitleSlide} [titleSlide]       the title slide (see withTitleSlides)
 * @property {"soundboard"|"cue"} [cueStyle] what a cue slide is called (see the top of this file)
 * @property {Record<string, RegExp>} [cueWords] the words that make a cue, by kind (CUE_WORDS)
 * @property {number} [lineLimit]            longest a spoken slide is left (LINE_LIMIT)
 * @property {string} [narratorColor]        the narrator's label colour, outside the palette (black)
 * @property {string} [titleLabel]           the title slide's label ("Title Slide")
 */
/**
 * Read a pasted script. Never throws and never drops a word: what comes before the first speaker becomes
 * heading slides rather than being left out.
 * @param {string} rawText @param {ParseOptions} [opts]
 * @returns {{ beats: Beat[], cast: Cast[] }}
 */
export function parseScript(rawText, opts = {}) {
  const palette = opts.palette?.length ? opts.palette : DEFAULT_PALETTE;
  const limit = opts.lineLimit ?? LINE_LIMIT;
  const dirOpts = { cueStyle: opts.cueStyle ?? "soundboard", cueWords: opts.cueWords ?? CUE_WORDS };
  // A template's guide sits above a "=== START SCRIPT ===" line: only what follows is the script.
  const marker = /^\W*start script\W*$/im.exec(rawText);
  const rawInput = marker ? rawText.slice(marker.index + marker[0].length) : rawText;
  // A screenplay is turned into "NAME: words" and starred directions first.
  const input = fromScreenplay(rawInput) ?? rawInput;
  const beats = [];
  const names = [];
  // "KT" after "Knight Trainer" is the same person: initials of a name already seen are that name.
  const initials = (n) => baseName(n).split(/\s+/).map((w) => w[0]).join("").toUpperCase();
  const remember = (n) => {
    const raw = n.trim();
    if (/^[A-Z]{2,4}$/.test(raw)) { const full = names.find((x) => baseName(x).includes(" ") && initials(x) === raw); if (full) return full; }
    const k = nameCase(n);
    // "Jester" after "Jester (Sam)" is the same person.
    if (!/\(/.test(k)) { const q = names.find((x) => x.toLowerCase().startsWith(`${k.toLowerCase()} (`)); if (q) return q; }
    if (!names.includes(k)) names.push(k);
    return k;
  };

  let current = null;
  // Before anyone speaks, the title block: "Title" slides, then "Long Verse" after a "LONG VERSE:" line.
  let heading = "Title";
  const speak = (who, words) => {
    const label = remember(who);
    for (const chunk of chunkSpeech(words, limit)) beats.push({ id: newId(), kind: "line", speaker: label, text: chunk });
  };
  const head = (words) => {
    for (const chunk of chunkSpeech(words, limit)) beats.push({ id: newId(), kind: "heading", speaker: heading, text: chunk });
  };

  // One pass over the text. A direction is anything in square brackets or loud asterisks, wherever it sits, so
  // "Shhhhh! [shushes her] We will get to it" becomes speech, a note, speech.
  for (const rawLine of input.replace(/\r/g, "").split("\n")) {
    if (!clean(rawLine)) continue;
    const whole = wholeDirection(rawLine);
    if (whole && (!whole.boldOnly || current)) { beats.push(...directionBeats(whole.text, true, false, dirOpts)); continue; }
    let first = true, afterDir = false;
    for (const piece of pieces(rawLine)) {
      if (piece.dir) {
        beats.push(...directionBeats(piece.text, piece.starred, piece.tech, dirOpts));
        first = false; afterDir = true;
        continue;
      }
      let words = piece.text;
      // A name can also follow a direction on the same line ("[Wren enters] WREN: Hi"), but only one in capitals
      // does: mid-line, "Like it says in Proverbs: ..." is not someone speaking.
      let sp = first || afterDir ? speakerOf(words) : null;
      if (sp && !first && sp.name !== sp.name.toUpperCase()) sp = null;
      if (sp) { current = remember(sp.name); words = sp.rest.trim(); }
      else if (!current && first) {
        const h = /^([A-Za-z][A-Za-z ]{0,30}?)\s*:\s*(.*)$/.exec(words);
        if (h && (h[1] === h[1].toUpperCase() || NOT_SPEAKERS.test(h[1].trim()))) { heading = nameCase(h[1]); words = h[2].trim(); }
      }
      first = false; afterDir = false;
      if (!words) continue;
      if (current) speak(current, words); else head(words);
    }
  }

  // "Jester:" said before "Jester (Sam):" is the same person: the plain name becomes the qualified one.
  for (const plain of names.filter((x) => !/\(/.test(x))) {
    const q = names.filter((x) => x.toLowerCase().startsWith(`${plain.toLowerCase()} (`));
    if (q.length === 1) {
      for (const b of beats) if (b.speaker === plain) b.speaker = q[0];
      names.splice(names.indexOf(plain), 1);
    }
  }

  // A speaker named for another ("Wren's Thoughts") is that actor on a different mic: same colour.
  const baseOf = (n) => names.find((b) => b !== n && (n.startsWith(`${b}’s `) || n.startsWith(`${b}'s `)));
  const own = new Map();
  names.filter((n) => !baseOf(n) && !NARRATOR.test(n)).forEach((n, i) => own.set(n, palette[i % palette.length]));
  for (const n of names) if (NARRATOR.test(n)) own.set(n, opts.narratorColor ?? NARRATOR_COLOR);
  const cast = names.map((label) => ({ label, color: own.get(label) ?? own.get(baseOf(label)) }));
  if (opts.reset && beats.at(-1)?.kind !== "reset") beats.push({ id: newId(), kind: "reset", text: "" });
  return { beats: withTitleSlides(beats, opts.titleSlide, opts.titleLabel), cast };
}

/** "1:54", "1:54.4" or "114" as seconds; undefined when it is not a length. @param {string | undefined} s */
export function lengthSeconds(s) {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(s ?? "");
  if (!m) return undefined;
  const secs = (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
  return secs > 0 ? secs : undefined;
}

/** "#ff8000" -> 0-1 channels, as ProPresenter stores a colour. @param {string} hex */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  const n = m ? parseInt(m[1], 16) : 0x808080;
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255, alpha: 1 };
}

/** What a beat reads as in the slide's notes: "Vista:139,1". Blank when there is no cue. @param {string | undefined} v */
export function vistaNote(v) {
  const t = (v ?? "").replace(/^\s*vista\s*[:\-]?\s*/i, "").replace(/\s+/g, "");
  return t ? `Vista:${t}` : "";
}
