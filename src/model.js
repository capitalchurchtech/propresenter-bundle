import { readBundle, isZip } from "./bundle.js";
import { decodePresentation } from "./schema.js";
import { createRoles } from "./roles.js";
import { readableText, readRangeFont } from "./rtf.js";

// A presentation as a person reads it: groups, the slides in each, and on each slide its label, its
// words, its boxes, its media and its macros. Read only; nothing here changes a file.

const NO_GROUP = "(no group)";

/**
 * Open a .pro or a .probundle from its bytes. A bundle is a zip of one .pro plus its media.
 * @param {Buffer} buf
 * @param {{ maxEntryBytes?: number }} [opts]
 * @returns {{ kind: "pro" | "probundle", proName: string | null, pro: Buffer, media: { name: string, file: string, bytes: number }[] }}
 */
export function openFile(buf, opts = {}) {
  if (!isZip(buf)) return { kind: "pro", proName: null, pro: buf, media: [] };
  const entries = readBundle(buf, opts);
  const pros = entries.filter((e) => /\.pro$/i.test(e.name));
  if (entries.some((e) => /(^|\/)Theme$/.test(e.name)) && !pros.length) throw new Error("This is a theme (.protheme), not a presentation. Open it with readThemeFile.");
  if (pros.length !== 1) throw new Error(pros.length ? `This bundle holds ${pros.length} presentations; expected one.` : "This zip holds no .pro file, so it is not a ProPresenter bundle.");
  return {
    kind: "probundle",
    proName: pros[0].name,
    pro: pros[0].data,
    media: entries.filter((e) => e !== pros[0]).map((e) => ({ name: e.name, file: e.name.split("/").pop(), bytes: e.data.length })),
  };
}

/** A ProPresenter colour as #rrggbb. Shared with workspaces. */
export const colorHex = (c) => {
  if (!c) return null;
  const h = (v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, "0");
  return `#${h(c.red)}${h(c.green)}${h(c.blue)}`;
};

const fileOf = (url) => url?.local?.path?.split("/").pop() ?? url?.absolute_string?.split("/").pop()?.replace(/%20/g, " ") ?? null;

/** Every media file a cue points at, slide boxes and media actions alike. */
export function mediaFilesOf(cue) {
  const out = [];
  for (const a of cue.actions ?? []) {
    const m = fileOf(a.media?.element?.url);
    if (m) out.push(m);
    for (const el of a.slide?.presentation?.base_slide?.elements ?? []) {
      const f = fileOf(el.element?.fill?.media?.url);
      if (f) out.push(f);
    }
  }
  return out;
}

// A box can take its words, picture, colour or visibility from somewhere else (ProPresenter's "linked"
// boxes): the slide's label, a timer, the clock, another slide. Named here in plain words.
const LINK_NAMES = {
  slide_Label_Text: "slide label", slide_Label_Color: "slide label colour", slide_text: "another slide's words",
  slide_image: "another slide's picture", group_name: "group name", group_color: "group colour",
  presentation: "presentation name", presentation_notes: "presentation notes", playlist_item: "playlist item",
  timer_text: "timer", clock_text: "clock", ccli_text: "CCLI details", stage_message: "stage message",
  message_text: "message", video_countdown: "video countdown", audio_countdown: "audio countdown", slide_count: "slide count",
  alternate_text: "another box's words", alternate_fill: "another box's fill", visibility_link: "shown or hidden by a condition",
  ticker: "ticker", rss_feed: "RSS feed", file_feed: "file feed", chord_chart: "chord chart", chord_pro_chart: "chord chart",
  output_screen: "output screen", pco_live: "Planning Center Live", auto_advance_time_remaining: "auto-advance time left",
  capture_status_text: "recording status", capture_status_color: "recording status colour", playback_marker_text: "playback marker",
  playback_marker_color: "playback marker colour", timecode_text: "timecode", timecode_status: "timecode status",
  key_value_text: "key value", key_value_fill: "key value fill", zone: "zone",
};
// The links that supply a box's words, so its own saved words are not what shows.
const WORDS_FROM = new Set(["slide_Label_Text", "slide_text", "group_name", "presentation", "presentation_notes", "playlist_item", "timer_text", "clock_text",
  "ccli_text", "stage_message", "message_text", "video_countdown", "audio_countdown", "slide_count", "alternate_text", "ticker", "rss_feed", "file_feed",
  "chord_chart", "chord_pro_chart", "auto_advance_time_remaining", "capture_status_text", "playback_marker_text", "timecode_text", "key_value_text"]);

/**
 * A box's links, each as { kind, name, words }: `words` true when the link supplies the words the box shows.
 * A link to the slide label is "slide label" for its own slide and "next slide's label" for the next one.
 * @param {any} el a slide element (the wrapper holding `element` and `data_links`)
 */
export function linksOf(el) {
  return (el.data_links ?? []).flatMap((l) => Object.keys(l).filter((k) => l[k] && typeof l[k] === "object").map((kind) => {
    const next = kind.startsWith("slide_Label") && (l[kind].slide_label_source === 1 || l[kind].slide_label_source === "SLIDE_LABEL_SOURCE_NEXT_SLIDE");
    return { kind, name: next ? `next slide's ${LINK_NAMES[kind].replace("slide ", "")}` : LINK_NAMES[kind] ?? kind.replace(/_/g, " "), words: WORDS_FROM.has(kind), next };
  }));
}

/** Whether a box shows its own slide's label as its words. */
export const showsOwnLabel = (el) => linksOf(el).some((l) => l.kind === "slide_Label_Text" && !l.next);

/** One box as a person reads it. Shared with themes (theme.js). */
export function elementModel(el, roleOf) {
  const x = el.element ?? {};
  const b = x.bounds ?? {};
  const rtf = x.text?.rtf_data ? Buffer.from(x.text.rtf_data).toString("latin1") : "";
  const text = rtf ? readableText(rtf) : "";
  const ranges = x.text?.attributes?.custom_attributes ?? [];
  const fontRange = ranges.find((c) => c._unknown_12?.length);
  const font = fontRange ? readRangeFont(fontRange._unknown_12[0]) : null;
  const fs = /\\fs(\d+)/.exec(rtf)?.[1];
  return {
    uuid: x.uuid?.string ?? null,
    name: x.name ?? "",
    role: roleOf(el),
    kind: x.fill?.media ? "image" : text ? "text" : x.fill?.enable ? "shape" : "other",
    bounds: { x: round(b.origin?.x), y: round(b.origin?.y), w: round(b.size?.width), h: round(b.size?.height) },
    text,
    fontName: font?.name ?? x.text?.attributes?.font?.name ?? null,
    fontFamily: font?.family ?? x.text?.attributes?.font?.family ?? null,
    fontSize: fs ? Number(fs) / 2 : x.text?.attributes?.font?.size ?? null,
    caps: ranges.some((c) => c.capitalization) || !!x.text?.attributes?.capitalization,
    media: fileOf(x.fill?.media?.url),
    links: linksOf(el).map((l) => l.name),
  };
}

/** The macros a list of actions fires, by name and id. Shared with themes. */
export const macrosOf = (actions) => (actions ?? []).filter((a) => a.macro).map((a) => {
  const id = a.macro.identification ?? {};
  return { name: id.parameter_name ?? null, uuid: id.parameter_uuid?.string ?? null, collection: id.parent_collection?.parameter_name ?? null, collectionUuid: id.parent_collection?.parameter_uuid?.string ?? null };
});

/** What kind each action is, in order. Shared with themes. */
export const actionOrderOf = (actions) => (actions ?? []).map((a) => (a.slide ? "slide" : a.macro ? "macro" : a.media ? "media" : a.clear ? "clear" : "other"));

const round = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : 0);

function slideModel(cue, roleOf) {
  const slideAction = (cue.actions ?? []).find((a) => a.slide);
  const els = slideAction?.slide?.presentation?.base_slide?.elements ?? [];
  const label = slideAction?.label?.text ?? cue.name ?? "";
  // A box linked to the slide's label shows the label, whatever words are saved in it.
  const elements = els.map((e) => ({ ...elementModel(e, roleOf), ...(showsOwnLabel(e) ? { text: label } : {}) }));
  return {
    uuid: cue.uuid?.string ?? null,
    label,
    enabled: cue.isEnabled !== false,
    text: elements.filter((e) => e.text).map((e) => e.text),
    elements,
    media: (cue.actions ?? []).filter((a) => a.media).map((a) => ({ file: fileOf(a.media.element?.url), layer: a.media.layer_type ?? null, name: a.name ?? null })),
    macros: macrosOf(cue.actions),
    actionOrder: actionOrderOf(cue.actions),
  };
}

/**
 * A decoded presentation as groups of slides, in the order ProPresenter shows them.
 * @param {any} doc a decoded rv.data.Presentation
 * @param {{ roles?: ReturnType<typeof createRoles> }} [opts]
 */
export function toModel(doc, { roles = createRoles() } = {}) {
  const cues = new Map((doc.cues ?? []).map((c) => [c.uuid?.string, c]));
  const placed = new Set();
  const groups = (doc.cue_groups ?? []).map((g) => ({
    uuid: g.group?.uuid?.string ?? null,
    name: g.group?.name ?? "",
    color: colorHex(g.group?.color),
    slides: (g.cue_identifiers ?? []).map((id) => cues.get(id.string)).filter(Boolean).map((c) => { placed.add(c); return slideModel(c, roles.roleOf); }),
  }));
  const loose = (doc.cues ?? []).filter((c) => !placed.has(c));
  if (loose.length) groups.push({ uuid: null, name: NO_GROUP, color: null, slides: loose.map((c) => slideModel(c, roles.roleOf)) });
  const groupName = new Map(groups.map((g) => [g.uuid, g.name]));
  return {
    uuid: doc.uuid?.string ?? null,
    name: doc.name ?? "",
    groups,
    arrangements: (doc.arrangements ?? []).map((a) => ({ name: a.name ?? "", groups: (a.group_identifiers ?? []).map((id) => groupName.get(id.string) ?? "(missing group)") })),
    slideCount: groups.reduce((n, g) => n + g.slides.length, 0),
    media: [...new Set((doc.cues ?? []).flatMap(mediaFilesOf))],
  };
}

/**
 * Bytes to a model in one step, keeping what the schema could not read.
 * @param {Buffer} buf a .pro or .probundle
 * @param {{ roles?: ReturnType<typeof createRoles>, maxEntryBytes?: number }} [opts]
 */
export function readPresentationFile(buf, opts = {}) {
  const file = openFile(buf, opts);
  const { doc, unknown } = decodePresentation(file.pro);
  return { file, doc, unknown, model: toModel(doc, opts) };
}
