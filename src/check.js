import { openFile, toModel, mediaFilesOf } from "./model.js";
import { checkPresentationBytes, decodePresentation } from "./schema.js";
import { createRoles } from "./roles.js";
import { createGeometry, linePitch, LINE_PADDING } from "./geometry.js";
import { markdownRuns } from "./runs.js";
import { STACK } from "./elements.js";

// WHAT TO LOOK AT BEFORE A FILE GOES NEAR THE BOOTH. Each finding names its slide and box and says
// what is wrong in one line. Severity: "problem" (the file will lose something or show something
// wrong), "warning" (likely wrong, worth a look), "note" (a house habit, or something not checked).
//
// Layout findings (overflow, a one-word last line) are PREDICTED from font metrics. With the
// package's rough fallback metrics they are a guess, and every such finding says so.

/**
 * @typedef {{ severity: "problem" | "warning" | "note", code: string, slide: string | null, box: string | null, message: string }} Finding
 */

/**
 * @param {Buffer} buf a .pro or .probundle
 * @param {{ roles?: ReturnType<typeof createRoles>, metrics?: import("./metrics.js").Metrics,
 *   knownMacros?: Set<string>, hasMedia?: (file: string) => boolean, maxEntryBytes?: number }} [opts]
 *   knownMacros: the macro UUIDs the workspace has now; hasMedia: whether the workspace has a media file.
 *   Without them, those checks are reported as not run.
 * @returns {{ findings: Finding[], model: any, predicted: "measured" | "rough", file: { kind: string, proName: string | null, media: { name: string, file: string, bytes: number }[] } }}
 */
export function checkFile(buf, opts = {}) {
  const roles = opts.roles ?? createRoles();
  const geo = createGeometry(opts.metrics ? { metrics: opts.metrics } : {});
  const findings = [];
  const add = (severity, code, slide, box, message) => findings.push({ severity, code, slide, box, message });

  const file = openFile(buf, opts);
  const bytes = checkPresentationBytes(file.pro);
  if (bytes.error) {
    add("problem", "unreadable", null, null, `The presentation could not be read: ${bytes.error}`);
    return { findings, model: null, predicted: geo.metrics.measured ? "measured" : "rough", file: { kind: file.kind, proName: file.proName, media: file.media } };
  }
  for (const u of bytes.unknown) {
    add("warning", "unknown-field", null, null, `Field ${u.field} of ${u.type} is not in the schema. It is carried through unchanged, but nothing here can read it.`);
  }
  if (!bytes.stable) add("problem", "unstable", null, null, "Reading and writing this file back does not give the same presentation. Do not save an edit of it.");

  const { doc } = decodePresentation(file.pro);
  const model = toModel(doc, { roles });

  // Media: what the slides point at against what the bundle carries, or the workspace has.
  const inBundle = new Set(file.media.map((m) => m.file));
  const referenced = new Set((doc.cues ?? []).flatMap(mediaFilesOf));
  if (file.kind === "probundle") {
    for (const f of referenced) if (!inBundle.has(f) && !opts.hasMedia?.(f)) add("problem", "missing-media", null, null, `${f} is used on a slide but is not in the bundle.`);
  } else if (opts.hasMedia) {
    for (const f of referenced) if (!opts.hasMedia(f)) add("problem", "missing-media", null, null, `${f} is used on a slide but is not in the workspace's media.`);
  } else if (referenced.size) {
    add("note", "media-not-checked", null, null, `${referenced.size} media file(s) referenced; whether they exist was not checked.`);
  }

  // Macros: a copied slide keeps the IDs of the machine it came from.
  const macroIds = new Set(model.groups.flatMap((g) => g.slides.flatMap((s) => s.macros.map((m) => m.uuid).filter(Boolean))));
  if (opts.knownMacros) {
    for (const g of model.groups) for (const s of g.slides) for (const m of s.macros) {
      if (m.uuid && !opts.knownMacros.has(m.uuid)) add("warning", "stale-macro", `${g.name} / ${s.label}`, null, `Macro "${m.name ?? m.uuid}" is not one this ProPresenter has; the slide will run nothing.`);
    }
  } else if (macroIds.size) {
    add("note", "macros-not-checked", null, null, `${macroIds.size} macro(s) referenced; whether this ProPresenter has them was not checked.`);
  }

  const rough = geo.metrics.measured ? "" : " (a rough guess: no font table for this church)";
  const cueById = new Map((doc.cues ?? []).map((c) => [c.uuid?.string, c]));
  for (const g of model.groups) {
    for (const s of g.slides) {
      const where = `${g.name} / ${s.label || "(no label)"}`;
      const cue = cueById.get(s.uuid);
      const els = (cue?.actions ?? []).find((a) => a.slide)?.slide?.presentation?.base_slide?.elements ?? [];

      // Object order against the house order (title in front, panel at the back).
      const order = s.elements.map((e) => STACK.indexOf(e.role === "other" ? "other" : e.role));
      if (order.some((v, i) => i > 0 && v < order[i - 1])) add("note", "object-order", where, null, `Objects run ${s.elements.map((e) => e.name || e.role).join(", ")}; the house order puts the title first and pictures and shapes behind the words.`);

      s.elements.forEach((e, i) => {
        const raw = els[i]?.element;
        if (e.kind !== "text" || !raw) return;
        const box = e.name || e.role;
        const attrs = raw.text?.attributes ?? {};
        // Capitals: a caps range shorter than the words leaves the rest in ordinary case.
        const caps = (attrs.custom_attributes ?? []).filter((c) => c.capitalization);
        const length = e.text.replace(/\n/g, "").length;
        for (const c of caps) {
          const end = c.range?.end ?? 0;
          if (end < length) add("warning", "caps-lost", where, box, `Capitals cover ${end} of ${length} characters; the rest show in ordinary case.`);
        }
        // Overflow and a one-word last line, predicted.
        const size = e.fontSize ?? 40;
        const multiple = attrs.paragraph_style?.line_height_multiple || 1;
        const face = e.role === "title" ? "head" : "body";
        const lines = geo.wrapRuns(markdownRuns(e.text.replace(/\*\*/g, "")), size, e.bounds.w - LINE_PADDING * 2, face);
        const need = size * 1.2 * Math.max(1, multiple) + (lines.length - 1) * linePitch(size, multiple);
        if (e.bounds.h && need > e.bounds.h + 2) add("warning", "overflow", where, box, `Predicted ${lines.length} line(s) needing ${Math.round(need)}px in a box ${Math.round(e.bounds.h)}px tall; ProPresenter clips what does not fit${rough}.`);
        if (lines.length > 1 && lines.at(-1).length === 1 && !/\n/.test(e.text)) add("note", "one-word-line", where, box, `Predicted to end on one word, "${lines.at(-1)[0].text}"${rough}.`);
      });
    }
  }
  return { findings, model, predicted: geo.metrics.measured ? "measured" : "rough", file: { kind: file.kind, proName: file.proName, media: file.media } };
}
