import { readBundle, writeBundle, isZip } from "./bundle.js";
import { loadSchema, OBJECT_OPTIONS, deepEqual } from "./schema.js";
import { addPlaceholders, findUnknownFields } from "./placeholders.js";
import { createRoles } from "./roles.js";
import { elementModel, macrosOf, actionOrderOf } from "./model.js";
import { uuid, freshCopy, mediaUrl } from "./elements.js";
import { workspaceOf, mediaEntryName } from "./media.js";

// Themes (.protheme): a zip of <name>/Theme, an rv.data.Template.Document, beside <name>/Assets/ holding
// the pictures its slides use. Read them, check them, and write a changed copy.
//
// A THEME IS WRITTEN AS A NEW FILE, never over the installed one: ProPresenter holds its themes open and
// overwrites changes made under it. A theme with a field the schema lacks is read but not written.

const THEME_ENTRY = /(^|\/)Theme$/;

/**
 * Open a .protheme from its bytes.
 * @param {Buffer} buf
 * @param {{ maxEntryBytes?: number }} [opts]
 */
export function openTheme(buf, opts = {}) {
  if (!isZip(buf)) throw new Error("This is not a theme: a .protheme is a zip, and this file is not one.");
  const entries = readBundle(buf, opts);
  const themes = entries.filter((e) => THEME_ENTRY.test(e.name));
  if (themes.length !== 1) throw new Error(themes.length ? `This zip holds ${themes.length} themes; expected one.` : "This zip holds no Theme file, so it is not a ProPresenter theme.");
  const theme = themes[0];
  const folder = theme.name.includes("/") ? theme.name.slice(0, theme.name.lastIndexOf("/")) : "";
  return {
    kind: "protheme",
    name: folder.split("/").pop() || null,
    themeEntry: theme.name,
    theme: theme.data,
    entries,
    assets: entries.filter((e) => e !== theme && !e.name.endsWith("/")).map((e) => ({ name: e.name, file: e.name.split("/").pop(), bytes: e.data.length })),
  };
}

/**
 * A theme's bytes as a plain object, plus what the schema could not read (carried as placeholders).
 * @param {Uint8Array} buf the Theme entry
 */
export function decodeTheme(buf) {
  const s = loadSchema();
  const unknown = findUnknownFields(s.ThemeDocument, buf);
  if (unknown.length) addPlaceholders(s.root, s.ThemeDocument, buf);
  const doc = s.ThemeDocument.toObject(s.ThemeDocument.decode(buf), OBJECT_OPTIONS);
  return { doc, unknown, schema: s };
}

/** Bytes for a theme object decoded with the same schema. */
export function encodeTheme(schema, doc) {
  return Buffer.from(schema.ThemeDocument.encode(schema.ThemeDocument.fromObject(doc)).finish());
}

/**
 * The same check as checkPresentationBytes: nothing the schema lacks, and decode, encode, decode gives the
 * same theme.
 * @param {Uint8Array} buf the Theme entry
 */
export function checkThemeBytes(buf) {
  try {
    const { doc, unknown, schema } = decodeTheme(buf);
    const again = schema.ThemeDocument.toObject(schema.ThemeDocument.decode(encodeTheme(schema, doc)), OBJECT_OPTIONS);
    const stable = deepEqual(doc, again);
    return { ok: unknown.length === 0 && stable, unknown, stable };
  } catch (err) {
    return { ok: false, unknown: [], stable: false, error: err.message };
  }
}

/**
 * A decoded theme as a person reads it: each theme slide, its boxes (with the uuid that names a box to
 * change) and what it fires.
 * @param {any} doc a decoded rv.data.Template.Document
 * @param {{ roles?: ReturnType<typeof createRoles> }} [opts]
 */
export function themeModel(doc, { roles = createRoles() } = {}) {
  const slides = (doc.slides ?? []).map((s, index) => {
    const base = s.base_slide ?? {};
    return {
      index,
      uuid: base.uuid?.string ?? null,
      name: s.name ?? "",
      size: base.size ? { w: base.size.width ?? 0, h: base.size.height ?? 0 } : null,
      elements: (base.elements ?? []).map((e) => elementModel(e, roles.roleOf)),
      macros: macrosOf(s.actions),
      actionOrder: actionOrderOf(s.actions),
    };
  });
  return { slides, slideCount: slides.length, media: [...new Set(slides.flatMap((s) => s.elements.map((e) => e.media).filter(Boolean)))] };
}

/**
 * Bytes to a model in one step.
 * @param {Buffer} buf a .protheme
 * @param {{ roles?: ReturnType<typeof createRoles>, maxEntryBytes?: number }} [opts]
 */
export function readThemeFile(buf, opts = {}) {
  const file = openTheme(buf, opts);
  const { doc, unknown, schema } = decodeTheme(file.theme);
  return { file, doc, unknown, schema, model: themeModel(doc, opts) };
}

/**
 * A changed copy of a theme, as .protheme bytes: every other entry (the pictures) exactly as it was, and
 * the Theme re-encoded from `doc`. Refuses a theme the schema could not fully read, and anything that does
 * not survive its own check, so a theme is never written with something quietly lost.
 * @param {ReturnType<typeof openTheme>} file
 * @param {any} doc
 * @param {ReturnType<typeof loadSchema>} schema the schema `doc` was decoded with
 */
export async function writeTheme(file, doc, schema) {
  if (findUnknownFields(loadSchema().ThemeDocument, file.theme).length) throw new Error("This theme holds fields this reader does not understand, so it is not written back: something in it would be lost or changed.");
  const data = encodeTheme(schema, doc);
  const check = checkThemeBytes(data);
  if (!check.ok) throw new Error(`The changed theme did not pass the check (${check.error ?? "unstable on re-read"}); nothing was written.`);
  return writeBundle(file.entries.map((e) => (e.name === file.themeEntry ? { name: e.name, data } : e)));
}

/**
 * The workspace a theme's pictures belong under: the one its library-root URLs name, else the folder its
 * Themes folder sits in (a theme's own pictures are under <workspace>/Themes/<name>/Assets).
 */
export function themeWorkspace(doc) {
  const direct = workspaceOf(doc);
  if (direct) return direct;
  const find = (v) => {
    if (!v || typeof v !== "object" || v instanceof Uint8Array) return null;
    let abs = "";
    if (typeof v.absolute_string === "string") {
      try {
        abs = decodeURI(v.absolute_string.replace(/^file:\/\//, ""));
      } catch {
        abs = ""; // a malformed address says nothing about the workspace
      }
    }
    if (abs.includes("/Themes/")) return abs.slice(0, abs.lastIndexOf("/Themes/"));
    for (const x of Array.isArray(v) ? v : Object.values(v)) { const f = find(x); if (f) return f; }
    return null;
  };
  return find(doc);
}

/**
 * A theme slide as a presentation slide: its boxes and its own actions (a background, say) with fresh ids.
 * A picture the theme keeps in its own Assets (root 12, relative to the theme) means nothing outside it, so
 * it is pointed at the workspace's Media/Assets, where ProPresenter puts a bundle's media on import, and its
 * bytes are returned to go into the bundle under that name.
 * @param {ReturnType<typeof openTheme>} file
 * @param {any} doc the decoded theme
 * @param {number} index the theme slide, from 0
 * @param {{ workspace: string, label?: string }} opts
 */
export function themeSlideAsCue(file, doc, index, { workspace, label } = {}) {
  const slide = doc.slides?.[index];
  if (!slide) throw new Error(`No theme slide ${index + 1}; the theme has ${doc.slides?.length ?? 0}.`);
  if (!workspace) throw new Error("Give the workspace the theme's pictures belong under.");
  const name = label ?? slide.name ?? "";
  const cue = {
    uuid: uuid(), name, isEnabled: true,
    actions: [
      { uuid: uuid(), isEnabled: true, type: 11, label: { text: name }, slide: { presentation: { base_slide: freshCopy(slide.base_slide ?? {}) } } },
      ...(slide.actions ?? []).map((a) => freshCopy(a)),
    ],
  };
  const media = new Map();
  const repoint = (u) => {
    if (u?.local?.root !== 12 || !u.local.path) return u;
    const pic = u.local.path.split("/").pop();
    const entry = file.entries.find((e) => e.name.endsWith(`/Assets/${pic}`));
    if (entry) media.set(pic, entry.data);
    return mediaUrl(pic, workspace);
  };
  const walk = (v) => {
    if (!v || typeof v !== "object" || v instanceof Uint8Array) return;
    for (const k of ["url", "local_url"]) if (v[k]?.local) v[k] = repoint(v[k]);
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x);
  };
  walk(cue);
  return { cue, media: [...media].map(([pic, data]) => ({ name: mediaEntryName(pic, workspace), data })) };
}
