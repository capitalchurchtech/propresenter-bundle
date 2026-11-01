import { randomUUID } from "node:crypto";
import { buildRtf, buildRanges, readRangeFont, writeRangeFont, boldOf, plainText } from "./rtf.js";
import { LINE_PADDING } from "./geometry.js";
import { fallbackMetrics } from "./metrics.js";

// Changing what is on a slide, the way ProPresenter itself would have written it.

/** A new ProPresenter UUID, upper case as ProPresenter writes them. */
export const uuid = () => ({ string: randomUUID().toUpperCase() });
const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

/**
 * A deep copy with every UUID replaced, consistently, so references inside the copy still line up.
 *
 * EXCEPT a `parameter_uuid`: that is a reference to something in the WORKSPACE (a macro, a prop, the
 * collection they sit in), not to anything in this file, so it must stay exactly as it is. Renumbered, a
 * copied slide pointed at a macro that does not exist and ran nothing.
 */
export function freshCopy(v) {
  const map = new Map();
  const walk = (x) => {
    if (Array.isArray(x)) return x.map(walk);
    if (x instanceof Uint8Array) return new Uint8Array(x);
    if (x && typeof x === "object") {
      const o = {};
      for (const [k, val] of Object.entries(x)) {
        if (k === "parameter_uuid") o[k] = structuredClone(val); // a workspace reference: left alone
        else if (k === "string" && typeof val === "string" && UUID_RE.test(val)) {
          if (!map.has(val)) map.set(val, randomUUID().toUpperCase());
          o[k] = map.get(val);
        } else o[k] = walk(val);
      }
      return o;
    }
    return x;
  };
  return walk(v);
}

/** The point size a box's RTF sets, or its attributes' size, or 40. */
export const rtfSize = (el) => {
  const fs = /\\fs(\d+)/.exec(Buffer.from(el.element.text.rtf_data).toString("latin1"))?.[1];
  return fs ? Number(fs) / 2 : el.element.text.attributes?.font?.size ?? 40;
};

/** The words a text element draws, trimmed. Empty for an image or a shape. */
export const textOf = (el) => (el.element.text?.rtf_data ? plainText(Buffer.from(el.element.text.rtf_data).toString("latin1")).trim() : "");

/**
 * New words in a text box, its RTF and its font ranges rebuilt together, the capitalisation range
 * carried over. `size` sets the box's point size, for words that need more or less room.
 * @param {any} el
 * @param {import("./runs.js").Run[]} runs
 * @param {number} [size]
 */
export function setText(el, runs, size) {
  const t = el.element.text;
  let rtf = Buffer.from(t.rtf_data).toString("latin1");
  if (size) { rtf = rtf.replace(/\\fs\d+/g, `\\fs${Math.round(size * 2)}`); t.attributes.font = { ...t.attributes.font, size }; }
  const ranges = t.attributes?.custom_attributes ?? [];
  const first = ranges.find((c) => c._unknown_12?.length)?._unknown_12[0];
  const font = first ? readRangeFont(first)
    : { name: t.attributes?.font?.name ?? "HelveticaNeue", size: t.attributes?.font?.size ?? 40, bold: false, family: t.attributes?.font?.family ?? "Helvetica Neue" };
  // The theme's regular face, even when its sample text happened to start bold.
  const regular = { ...font, ...(size ? { size } : {}), bold: false, name: font.bold ? font.name.replace(/-Bold$/, "") || "HelveticaNeue" : font.name };
  t.rtf_data = Buffer.from(buildRtf(rtf, runs, regular.name, boldOf(regular.name)), "latin1");
  // CAPITALISATION LIVES IN ITS OWN RANGE, as long as the old words. A box set in all caps shows its
  // new words in ordinary case if only the font ranges are rebuilt, so the range is carried over,
  // stretched to the new words.
  const caps = ranges.find((c) => c.capitalization)?.capitalization;
  const length = runs.reduce((n, r) => n + r.text.length, 0);
  t.attributes.custom_attributes = [...(caps && length ? [{ range: { end: length }, capitalization: caps }] : []), ...buildRanges(runs, regular)];
}

/**
 * A media URL in both the forms ProPresenter writes: the exporting Mac's absolute path (not portable)
 * and the relative one under root 10, ROOT_SHOW, the importing workspace's own Media folder, which is
 * what makes a bundle portable. `workspace` is the absolute path of the workspace folder.
 * @param {string} file
 * @param {string} workspace
 */
export function mediaUrl(file, workspace) {
  const rel = `Media/Assets/${file}`;
  return { absolute_string: "file://" + encodeURI(`${workspace}/${rel}`), platform: 1, local: { root: 10, path: rel } };
}

/**
 * A new picture in an image box, uncropped. Each image box in a theme still carries the crop set for
 * the sample picture it was built with, which crops the wrong thing on a new one, so a new image
 * arrives already shaped for its box.
 * @param {any} el
 * @param {{ file: string, w: number, h: number, format: string }} m
 * @param {string} workspace
 */
export function setImage(el, m, workspace) {
  const media = el.element.fill.media;
  media.uuid = uuid();
  media.url = mediaUrl(m.file, workspace);
  media.metadata = { format: m.format };
  media.image = media.image ?? {};
  media.image.drawing = {
    ...(media.image.drawing ?? {}),
    natural_size: { width: m.w, height: m.h },
    crop_enable: false,
    crop_insets: {},
  };
  media.image.file = { local_url: mediaUrl(m.file, workspace) };
}

/** The name each job gets, and the house order of jobs, front to back. */
export const ELEMENT_NAMES = {
  title: "Title", kicker: "Subtitle", description: "Description", link: "Link", qr: "QR code", photo: "Photo", highlight: "Highlight", panel: "Panel",
};
export const STACK = ["title", "kicker", "description", "link", "other", "qr", "photo", "highlight", "panel"];

/**
 * THE OBJECTS LIST, TIDIED. ProPresenter lists a slide's objects front to back and names an unnamed
 * text box after its own words. This puts the words in front, title first, then subtitle, description
 * and link; pictures behind them; highlight boxes and the panel at the back. Each box is named for its
 * job when the slide has only one of that job (a slide with two descriptions keeps its own names).
 *
 * A picture is renamed only when `ownsPicture` says it is one this app placed: on a hand-made slide a
 * logo can pass for a photo or a QR code by its shape alone.
 * @param {any[]} els
 * @param {(el: any) => import("./roles.js").Role} roleOf
 * @param {{ ownsPicture?: (fileName: string) => boolean }} [opts]
 */
export function tidyElements(els, roleOf, { ownsPicture = () => false } = {}) {
  const count = new Map();
  for (const e of els) count.set(roleOf(e), (count.get(roleOf(e)) ?? 0) + 1);
  const ours = (e) => ownsPicture(e.element.fill?.media?.url?.local?.path?.split("/").pop() ?? "");
  for (const e of els) {
    const r = roleOf(e), name = ELEMENT_NAMES[r];
    if (name && (count.get(r) === 1 || r === "highlight") && (r !== "qr" && r !== "photo" || ours(e))) e.element.name = name;
  }
  return els.map((e, i) => [e, i])
    .sort((a, b) => STACK.indexOf(roleOf(a[0])) - STACK.indexOf(roleOf(b[0])) || a[1] - b[1])
    .map(([e]) => e);
}

/**
 * A SPEAKER BOX THAT HOLDS ITS WORDS ON ONE LINE. Widened as far as the slide allows (`maxRight` stops
 * short of anything beside it), and if the words still do not fit, the type steps down in the same
 * proportion, to no less than 60%. Never narrower or larger than it was made. An all-caps box is
 * measured at its capital width.
 * @param {any} el
 * @param {string} words
 * @param {number} [maxRight]
 * @param {import("./metrics.js").Metrics} [metrics]
 */
export function fitSpeakerBox(el, words, maxRight = 1860, metrics = fallbackMetrics) {
  const b = el.element.bounds, size = rtfSize(el);
  const pad = LINE_PADDING * 2 + 4;
  const caps = (el.element.text.attributes?.custom_attributes ?? []).some((c) => c.capitalization);
  const text = metrics.widthOf(caps ? words.toUpperCase() : words, size, "body");
  const room = maxRight - b.origin.x;
  if (text + pad <= b.size.width) return;
  if (text + pad <= room) { b.size.width = text + pad; return; }
  b.size.width = Math.max(b.size.width, room);
  const to = Math.floor(Math.max(0.6, (room - pad) / text) * size * 2) / 2; // whole half-points, as RTF has them
  const t = el.element.text;
  t.rtf_data = Buffer.from(Buffer.from(t.rtf_data).toString("latin1").replace(/\\fs\d+/g, `\\fs${to * 2}`), "latin1");
  for (const ca of t.attributes?.custom_attributes ?? []) {
    if (ca._unknown_12) ca._unknown_12 = ca._unknown_12.map((raw) => writeRangeFont({ ...readRangeFont(raw), size: to }));
  }
  if (t.attributes?.font?.size) t.attributes.font.size = to;
}

const plainName = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s'-]/g, " ").trim().split(/\s+/).filter(Boolean);

/**
 * A person's line from a table of names, such as the title printed under a speaker's name. Exact
 * first, then ignoring case, accents, spacing and punctuation, then by first and last name alone (a
 * middle name or initial). The last step answers only when exactly one listed person matches, so a
 * shared surname never lends somebody else's title. Undefined when nobody does.
 *
 * The table is the church's data, kept in its pack, never in code.
 * @param {string} name
 * @param {Record<string, string>} table
 */
export function roleFor(name, table) {
  if (table[name.trim()]) return table[name.trim()];
  const want = plainName(name);
  if (!want.length) return undefined;
  const hits = Object.keys(table).filter((k) => {
    const have = plainName(k);
    return have.join(" ") === want.join(" ") || (have.length > 1 && want.length > 1 && have[0] === want[0] && have.at(-1) === want.at(-1));
  });
  return hits.length === 1 ? table[hits[0]] : undefined;
}

/**
 * Background media repointed from one file to another, at the new picture's size: for a theme whose
 * slides point at an older copy of a picture the church has since replaced. `map` is the pack's:
 * file name -> { file, w, h }.
 * @param {any} cue
 * @param {Record<string, { file: string, w: number, h: number }>} map
 * @param {string} workspace
 */
export function repointBackgrounds(cue, map, workspace) {
  for (const a of cue.actions) {
    const el = a.media?.element;
    const to = map[el?.url?.local?.path?.split("/").pop() ?? ""];
    if (!to) continue;
    el.url = mediaUrl(to.file, workspace);
    if (el.image?.file) el.image.file = { local_url: mediaUrl(to.file, workspace) };
    if (el.image?.drawing) el.image.drawing.natural_size = { width: to.w, height: to.h };
  }
}

/**
 * One action order on every slide: the slide, then the macro, then the media, anything else after.
 * Stable. `macro`, when given, repoints every macro action to it (IDs go stale; read the current ones
 * from ProPresenter rather than trusting a copy). `dropClear` drops clear actions.
 * @param {any} cue
 * @param {{ macro?: any, dropClear?: boolean }} [opts]
 */
export function tidyActions(cue, { macro, dropClear = false } = {}) {
  if (dropClear) cue.actions = cue.actions.filter((a) => !a.clear);
  if (macro) for (const a of cue.actions) if (a.macro) a.macro.identification = structuredClone(macro);
  const rank = (a) => (a.slide ? 0 : a.macro ? 1 : a.media ? 2 : 3);
  cue.actions = cue.actions.map((a, i) => [a, i])
    .sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1])
    .map(([a]) => a);
}

/**
 * Every box in a presentation or a theme, with the name of the slide it is on. The objects are the
 * document's own, so changing one changes the document: `element` is the box, `wrapper` the slide element
 * holding it (where its links are), `base` the slide's own list of boxes, and for a presentation `cue` and
 * `action` the slide it is on (where its label is).
 * @param {any} doc a decoded presentation or theme
 */
export function elementsOf(doc) {
  const out = [];
  for (const [i, s] of (doc.slides ?? []).entries()) {
    for (const e of s.base_slide?.elements ?? []) if (e.element) out.push({ slide: s.name || `Theme slide ${i + 1}`, element: e.element, wrapper: e, base: s.base_slide, cue: null, action: null });
  }
  for (const c of doc.cues ?? []) {
    for (const a of c.actions ?? []) {
      for (const e of a.slide?.presentation?.base_slide?.elements ?? []) if (e.element) out.push({ slide: a.label?.text || c.name || "", element: e.element, wrapper: e, base: a.slide.presentation.base_slide, cue: c, action: a });
    }
  }
  return out;
}

/**
 * Rename a box, found by its uuid, in a presentation or a theme. Only the name changes.
 * @returns {number} how many boxes carried that uuid (normally one)
 */
export function renameElement(doc, elementUuid, name) {
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean) throw new Error("Give the box a name.");
  if (clean.length > 120) throw new Error("A box's name can be at most 120 characters.");
  const hits = elementsOf(doc).filter((x) => x.element.uuid?.string === elementUuid);
  if (!hits.length) throw new Error(`No box with the id ${elementUuid} in this file.`);
  for (const h of hits) h.element.name = clean;
  return hits.length;
}
