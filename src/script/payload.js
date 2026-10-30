// What a page or an MCP client sends back to build from, checked and cleaned. A Beat field that is not copied
// here never reaches the builder (a picture's label was once lost that way), and nothing else would notice, so
// the whitelist is in one place and tested.
import { BEAT_KINDS, MACRO_CHOICES } from "./parse.js";

export const MAX_BEATS = 3000;

/** A name that is only a file name: no folders, no characters a path or a zip entry would read. @param {string} s */
export const fileName = (s) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^\.+/, "").trim().slice(0, 120);

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * The request's JSON as something to build, or the message to answer with.
 * @param {unknown} raw
 * @param {{ key: string, label: string }[]} types  the kinds of show the church's pack offers
 * @returns {{ type: string, name: string, beats: import("./parse.js").Beat[], cast: import("./parse.js").Cast[], titleSlide?: { file: string, extras: string[] } } | { error: string }}
 */
export function readPayload(raw, types) {
  const payload = raw && typeof raw === "object" ? raw : {};
  const rawBeats = Array.isArray(payload.beats) ? payload.beats.filter((b) => b && typeof b === "object") : [];
  if (!rawBeats.length) return { error: "There are no slides to build." };
  if (rawBeats.length > MAX_BEATS) return { error: `More than ${MAX_BEATS} slides.` };

  const type = payload.type === undefined ? types[0]?.key : payload.type;
  const known = types.find((t) => t.key === type);
  if (!known) return { error: `Unknown kind of show. Choose one of: ${types.map((t) => `${t.label} (${t.key})`).join(", ")}.` };

  const beats = rawBeats.map((b, i) => ({
    id: str(b.id, 40) || `b${i}`,
    kind: BEAT_KINDS.includes(b.kind) ? b.kind : "note",
    speaker: str(b.speaker, 80) || undefined,
    text: str(b.text, 4000),
    file: fileName(str(b.file, 200)) || undefined,
    length: str(b.length, 12) || undefined,
    vista: str(b.vista, 40) || undefined,
    label: str(b.label, 60) || undefined,
    macro: MACRO_CHOICES.includes(b.macro) ? b.macro : "auto",
  }));
  const cast = (Array.isArray(payload.cast) ? payload.cast : [])
    .filter((c) => c && typeof c === "object")
    .map((c) => ({ label: str(c.label, 80), color: str(c.color, 9) }));

  // The title slide: a file name, and the names of the extra copies to put in the title group (at most five).
  const ts = payload.titleSlide && typeof payload.titleSlide === "object" ? payload.titleSlide : null;
  const titleFile = ts ? fileName(str(ts.file, 200)) : "";
  const titleSlide = titleFile
    ? { file: titleFile, extras: (Array.isArray(ts.extras) ? ts.extras : []).map((e) => str(e, 40).trim()).filter(Boolean).slice(0, 5) }
    : undefined;
  const name = fileName(str(payload.name, 80)) || known.label;
  return { type: known.key, name, beats, cast, ...(titleSlide ? { titleSlide } : {}) };
}
