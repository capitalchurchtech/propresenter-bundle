// TWO VERSIONS OF A PRESENTATION, COMPARED: the method that taught the most. Keep the file as it was
// imported and the file after the operator's hand fixes, flatten each slide to group, label, boxes
// (name, position, words, picture) and media, and every difference is something the import should
// have done.
//
// Slides are matched by group and label (the nth slide with that label in that group), boxes by name
// (the nth box with that name). A slide or box with no partner is added or removed.

const key = (counts, base) => {
  const n = (counts.get(base) ?? 0) + 1;
  counts.set(base, n);
  return n > 1 ? `${base} #${n}` : base;
};

function slidesByKey(model) {
  const out = new Map();
  for (const g of model.groups) {
    const counts = new Map();
    for (const s of g.slides) out.set(key(counts, `${g.name} / ${s.label || "(no label)"}`), s);
  }
  return out;
}

const boundsText = (b) => `${b.x},${b.y} ${b.w}x${b.h}`;

function elementsByKey(slide) {
  const counts = new Map();
  const out = new Map();
  for (const e of slide.elements) out.set(key(counts, e.name || `(unnamed ${e.role})`), e);
  return out;
}

function compareBoxes(changes, k, x, y) {
  if (boundsText(x.bounds) !== boundsText(y.bounds)) changes.push({ what: "moved or resized", box: k, before: boundsText(x.bounds), after: boundsText(y.bounds) });
  if (x.text !== y.text) changes.push({ what: "words", box: k, before: x.text, after: y.text });
  if (x.media !== y.media) changes.push({ what: "picture", box: k, before: x.media, after: y.media });
  if (x.fontSize !== y.fontSize) changes.push({ what: "type size", box: k, before: x.fontSize, after: y.fontSize });
  if (x.caps !== y.caps) changes.push({ what: "capitals", box: k, before: x.caps, after: y.caps });
}

function compareSlides(a, b) {
  const changes = [];
  const ea = elementsByKey(a), eb = elementsByKey(b);
  const gone = [...ea].filter(([k]) => !eb.has(k));
  const fresh = [...eb].filter(([k]) => !ea.has(k));
  // A box the operator only renamed is the same box: paired by its job and its words or picture.
  const renamed = new Map();
  for (const [k, x] of gone) {
    const hit = fresh.find(([k2, y]) => !renamed.has(k2) && y.role === x.role && (y.text || y.media) === (x.text || x.media));
    if (hit) renamed.set(hit[0], k);
  }
  const renamedFrom = new Set(renamed.values());
  for (const [k, x] of ea) {
    const y = eb.get(k);
    if (y) compareBoxes(changes, k, x, y);
    else if (!renamedFrom.has(k)) changes.push({ what: "box removed", box: k, before: x.text || x.media || x.role, after: null });
  }
  for (const [k, y] of eb) {
    if (ea.has(k)) continue;
    const from = renamed.get(k);
    if (from) { changes.push({ what: "renamed", box: k, before: from, after: k }); compareBoxes(changes, k, ea.get(from), y); }
    else changes.push({ what: "box added", box: k, before: null, after: y.text || y.media || y.role });
  }
  const order = (s) => s.elements.map((e) => e.name || e.role).join(" > ");
  if (ea.size === eb.size && order(a) !== order(b)) changes.push({ what: "objects order", box: null, before: order(a), after: order(b) });
  const media = (s) => s.media.map((m) => `${m.file}${m.layer != null ? ` (layer ${m.layer})` : ""}`).join(", ");
  if (media(a) !== media(b)) changes.push({ what: "media", box: null, before: media(a), after: media(b) });
  const macros = (s) => s.macros.map((m) => `${m.collection ?? "?"} > ${m.name ?? "?"}`).join(", ");
  if (macros(a) !== macros(b)) changes.push({ what: "macros", box: null, before: macros(a), after: macros(b) });
  if (a.actionOrder.join(",") !== b.actionOrder.join(",")) changes.push({ what: "action order", box: null, before: a.actionOrder.join(", "), after: b.actionOrder.join(", ") });
  if (a.enabled !== b.enabled) changes.push({ what: "enabled", box: null, before: a.enabled, after: b.enabled });
  return changes;
}

/**
 * What changed from `before` to `after`, two models from `toModel`.
 * @returns {{ added: string[], removed: string[], changed: { slide: string, changes: { what: string, box: string | null, before: any, after: any }[] }[], groups: { before: string[], after: string[] } | null, arrangements: { before: string[], after: string[] } | null }}
 */
export function diffModels(before, after) {
  const a = slidesByKey(before), b = slidesByKey(after);
  const added = [...b.keys()].filter((k) => !a.has(k));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const changed = [];
  for (const [k, s] of a) {
    const t = b.get(k);
    if (!t) continue;
    const changes = compareSlides(s, t);
    if (changes.length) changed.push({ slide: k, changes });
  }
  const names = (m) => m.groups.map((g) => g.name);
  const arr = (m) => m.arrangements.map((x) => `${x.name}: ${x.groups.join(", ")}`);
  return {
    added, removed, changed,
    groups: names(before).join("|") === names(after).join("|") ? null : { before: names(before), after: names(after) },
    arrangements: arr(before).join("|") === arr(after).join("|") ? null : { before: arr(before), after: arr(after) },
  };
}
