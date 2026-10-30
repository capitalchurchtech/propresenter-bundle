// A script's beats read back for people, before anything is built: as a play's script, and as the checklist a
// booth works through before a show (what operators check, in their words): the macros and the timing; the
// videos and sounds to add and test; the pictures the script names, to pull or create; and the macros on and
// after each gag slide. Also the questions to put to the person before building: the cast's label colours,
// and any slide they reuse (a title, verse or logo slide).
import { cuesOf, CUE_WORDS } from "./parse.js";

/**
 * ProPresenter's own label colours, in the order its colour picker shows them (read from ProPresenter 21's
 * picker; a channel may be one off what it stores). The last is no colour at all.
 */
export const LABEL_SWATCHES = [
  "#0177cc", "#015999", "#003c66", "#0168b3", "#004a80", "#002d4d",
  "#cc014e", "#99013b", "#660027", "#b30144", "#7600cc", "#590099",
  "#3b0066", "#cc298b", "#cc2929", "#998f1f", "#7e7619", "#23b44c",
  "#000000",
];

const SCREEN = ["picture", "background", "video"];
const soundKinds = (label) => (label.match(/\b(VIDEO|AUDIO)\b/g) ?? []);

/**
 * The beats as a play's script, one numbered row per slide: the speaker in capitals, the line under it,
 * directions in brackets, cues and media as tags. Plain text, so it reads in a terminal, a chat or a file.
 * @param {import("./parse.js").Beat[]} beats
 */
export function playScript(beats) {
  const out = [];
  let last = null;
  beats.forEach((b, i) => {
    const n = String(i + 1).padStart(3);
    if (b.kind === "line") {
      if (b.speaker !== last) out.push(`${n}  ${String(b.speaker ?? "").toUpperCase()}`);
      out.push(`${b.speaker !== last ? "    " : n}      ${b.text}`);
      last = b.speaker;
      return;
    }
    last = null;
    const vista = b.vista ? `  {Vista:${b.vista}}` : "";
    if (b.kind === "heading") out.push(`${n}  ${String(b.speaker ?? "").toUpperCase()}: ${b.text}`);
    else if (b.kind === "note") out.push(`${n}          [${b.text.replace(/^\*|\*$/g, "")}]${vista}`);
    else if (b.kind === "cue") out.push(`${n}  >> ${b.text} (cue slide: holds for the operator)`);
    else if (b.kind === "lights") out.push(`${n}  >> LIGHTS${b.text ? `: ${b.text}` : ""}${vista}`);
    else if (b.kind === "reset") out.push(`${n}  >> RESET${vista}`);
    else out.push(`${n}  >> ${b.kind.toUpperCase()}: ${b.file ?? "(no file yet)"}${b.label ? ` · ${b.label}` : ""}${b.length ? ` · ${b.length}` : ""}${vista}`);
  });
  return out.join("\n");
}

/**
 * The booth's checklist for these beats. `recipe` supplies the room's timing.
 * @param {import("./parse.js").Beat[]} beats
 * @param {{ noteAdvanceSeconds?: number|null, cueWords?: Record<string, RegExp> }} [recipe]
 */
export function checklist(beats, recipe = {}) {
  const words = recipe.cueWords ?? CUE_WORDS;
  const sound = [], lights = [], pictures = [], gags = [];
  beats.forEach((b, i) => {
    const n = i + 1;
    // Sound: every cue slide that warns the desk, and every video or sound slide to add and test.
    if (b.kind === "cue" && soundKinds(b.text).length) sound.push({ slide: n, what: b.text, direction: beats[i - 1]?.kind === "note" ? beats[i - 1].text : "", file: "" });
    if (b.kind === "video" || b.kind === "audio") sound.push({ slide: n, what: b.kind.toUpperCase(), direction: b.text, file: b.file ?? "" });
    // Lights ride as a Vista note on the gag or sound slide that fires them where there is one close by.
    if (b.kind === "note" && cuesOf(b.text, words).includes("LIGHTS")) {
      const near = [i, i + 1, i + 2].map((k) => beats[k]).find((x) => x && (SCREEN.includes(x.kind) || x.kind === "audio" || (x.kind === "cue" && soundKinds(x.text).length)));
      const on = near ? beats.indexOf(near) + 1 : n;
      lights.push({ slide: n, direction: b.text, fireOn: on, vista: (near ?? b).vista ?? b.vista ?? "" });
    }
    // Pictures: named files to have on the Mac, and gags the script describes with no file yet.
    if ((b.kind === "picture" || b.kind === "background") && b.file) {
      // One entry per file, however many slides show it (a title slide comes back after every gag).
      const had = pictures.find((p) => p.file === b.file);
      if (had) had.slides.push(n); else pictures.push({ slide: n, slides: [n], file: b.file, direction: "" });
    }
    if (b.kind === "cue" && /\bPICTURE\b/.test(b.text)) pictures.push({ slide: n, file: "", direction: beats[i - 1]?.text ?? "" });
    // Gags and the slide after each: the macro that puts the picture up, and the one that brings the script back.
    if (SCREEN.includes(b.kind)) gags.push({ slide: n, file: b.file ?? "", macro: b.macro ?? "auto", next: beats[i + 1] ? { slide: n + 1, macro: beats[i + 1].macro ?? "auto" } : null });
  });
  const notes = beats.filter((b) => b.kind === "note").length;
  const timing = {
    sceneNotes: notes,
    noteAdvanceSeconds: recipe.noteAdvanceSeconds ?? null,
    cueSlidesHold: beats.filter((b) => b.kind === "cue").length,
    advice: recipe.noteAdvanceSeconds == null ? "Scene Notes keep the template's own advance time: check it in ProPresenter." : `Scene Notes play on after ${recipe.noteAdvanceSeconds} s; cue slides hold for the operator.`,
  };
  return { sound, lights, pictures, gags, timing };
}

/**
 * What to ask the person before building: the cast's colours (from ProPresenter's swatches) and the slides
 * they reuse. Building waits for both answers.
 * @param {import("./parse.js").Cast[]} cast
 */
export function questions(cast) {
  return [
    { id: "colors", ask: "Which label colour for each speaker? These are proposed from the show's palette; ProPresenter's own swatches are listed.", proposed: cast, swatches: LABEL_SWATCHES },
    { id: "reused", ask: "Does this show reuse any slides: a title slide (its picture file in Media/Assets), a verse slide, a logo slide? Say none if not." },
  ];
}
