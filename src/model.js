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
  if (entries.some((e) => /(^|\/)Theme$/.test(e.name)) && !pros.length) throw new Error("This is a theme (.protheme), not a presentation. Themes are not opened here yet.");
  if (pros.length !== 1) throw new Error(pros.length ? `This bundle holds ${pros.length} presentations; expected one.` : "This zip holds no .pro file, so it is not a ProPresenter bundle.");
  return {
    kind: "probundle",
    proName: pros[0].name,
    pro: pros[0].data,
    media: entries.filter((e) => e !== pros[0]).map((e) => ({ name: e.name, file: e.name.split("/").pop(), bytes: e.data.length })),
  };
}

const colorHex = (c) => {
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

function elementModel(el, roleOf) {
  const x = el.element ?? {};
  const b = x.bounds ?? {};
  const rtf = x.text?.rtf_data ? Buffer.from(x.text.rtf_data).toString("latin1") : "";
  const text = rtf ? readableText(rtf) : "";
  const ranges = x.text?.attributes?.custom_attributes ?? [];
  const fontRange = ranges.find((c) => c._unknown_12?.length);
  const font = fontRange ? readRangeFont(fontRange._unknown_12[0]) : null;
  const fs = /\\fs(\d+)/.exec(rtf)?.[1];
  return {
    name: x.name ?? "",
    role: roleOf(el),
    kind: x.fill?.media ? "image" : text ? "text" : x.fill?.enable ? "shape" : "other",
    bounds: { x: round(b.origin?.x), y: round(b.origin?.y), w: round(b.size?.width), h: round(b.size?.height) },
    text,
    fontName: font?.name ?? x.text?.attributes?.font?.name ?? null,
    fontSize: fs ? Number(fs) / 2 : x.text?.attributes?.font?.size ?? null,
    caps: ranges.some((c) => c.capitalization) || !!x.text?.attributes?.capitalization,
    media: fileOf(x.fill?.media?.url),
  };
}

const round = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : 0);

function slideModel(cue, roleOf) {
  const slideAction = (cue.actions ?? []).find((a) => a.slide);
  const els = slideAction?.slide?.presentation?.base_slide?.elements ?? [];
  const elements = els.map((e) => elementModel(e, roleOf));
  return {
    uuid: cue.uuid?.string ?? null,
    label: slideAction?.label?.text ?? cue.name ?? "",
    enabled: cue.isEnabled !== false,
    text: elements.filter((e) => e.text).map((e) => e.text),
    elements,
    media: (cue.actions ?? []).filter((a) => a.media).map((a) => ({ file: fileOf(a.media.element?.url), layer: a.media.layer_type ?? null, name: a.name ?? null })),
    macros: (cue.actions ?? []).filter((a) => a.macro).map((a) => {
      const id = a.macro.identification ?? {};
      return { name: id.parameter_name ?? null, uuid: id.parameter_uuid?.string ?? null, collection: id.parent_collection?.parameter_name ?? null, collectionUuid: id.parent_collection?.parameter_uuid?.string ?? null };
    }),
    actionOrder: (cue.actions ?? []).map((a) => (a.slide ? "slide" : a.macro ? "macro" : a.media ? "media" : a.clear ? "clear" : "other")),
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
