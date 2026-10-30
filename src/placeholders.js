import protobuf from "protobufjs";

// THE SCHEMA IS A VERSION BEHIND PROPRESENTER 21, and protobufjs drops a field it does not know
// SILENTLY on decode. A decode-and-encode of a real file would quietly lose whatever the schema lacks
// (it lacked the per-range font every text box carries, 3.5KB of styling on a 28-slide export). So a
// file is walked against the schema as raw bytes first: `findUnknownFields` reports what is missing,
// `addPlaceholders` adds each as a raw field of the right wire type so it is carried through untouched.

const WT = { 0: "uint64", 1: "fixed64", 2: "bytes", 5: "fixed32" };

// Duck-typed rather than `instanceof`: the caller's schema may come from its own copy of protobufjs,
// and a class from one copy is not an instance of the same class from another.
const isMessageType = (t) => !!t && typeof t === "object" && "fieldsById" in t && "fieldsArray" in t;

/** The Field class of the protobufjs copy that built `top`, so an added field is one it accepts. */
function fieldClassOf(top) {
  const seen = new Set();
  const find = (t) => {
    if (!t || seen.has(t)) return null;
    seen.add(t);
    for (const f of t.fieldsArray) return f.constructor;
    for (const n of t.nestedArray ?? []) { const c = find(n); if (c) return c; }
    return null;
  };
  return find(top) ?? protobuf.Field;
}

function walkUnknown(type, buf, onUnknown) {
  const walk = (t, s, e, at) => {
    const r = protobuf.Reader.create(buf.subarray(s, e));
    while (r.pos < r.len) {
      const tag = r.uint32(), fn = tag >>> 3, wt = tag & 7;
      const f = t.fieldsById[fn];
      if (wt === 2) {
        const len = r.uint32(); const cs = r.pos; r.skip(len);
        if (f && isMessageType(f.resolvedType)) walk(f.resolvedType, s + cs, s + cs + len, `${at}.${f.name}`);
      } else if (wt === 0) r.uint64(); else if (wt === 1) r.skip(8); else if (wt === 5) r.skip(4); else r.skipType(wt);
      if (!f) onUnknown(t, fn, wt, at);
    }
  };
  walk(type, 0, buf.length, type.name);
}

/**
 * Every field in `buf` the schema does not define, as `{ type, field, wireType, path }`, one per
 * distinct type and field number. Empty means a decode loses nothing.
 * @param {protobuf.Type} top
 * @param {Uint8Array} buf
 */
export function findUnknownFields(top, buf) {
  const seen = new Map();
  walkUnknown(top, Buffer.from(buf), (t, fn, wt, path) => {
    const k = `${t.fullName}#${fn}`;
    if (!seen.has(k)) seen.set(k, { type: t.fullName.replace(/^\./, ""), field: fn, wireType: wt, path });
  });
  return [...seen.values()];
}

/**
 * Every field the schema does not define becomes a raw placeholder of the right wire type, repeated
 * until a walk finds none, so a decode-and-encode writes the file back untouched. Changes `root`.
 * @param {protobuf.Root} root
 * @param {protobuf.Type} top
 * @param {Uint8Array} buf
 */
export function addPlaceholders(root, top, buf) {
  const b = Buffer.from(buf);
  const Field = fieldClassOf(top);
  for (;;) {
    let added = 0;
    walkUnknown(top, b, (t, fn, wt) => {
      if (t.fieldsById[fn]) return; // added earlier in this same walk
      t.add(new Field(`_unknown_${fn}`, fn, WT[wt], "repeated", undefined, wt === 2 ? undefined : { packed: false }));
      added++;
    });
    root.resolveAll();
    if (!added) break;
  }
}

/**
 * Placeholders of a number type are written one value per tag, as ProPresenter writes them, not packed
 * into one length-prefixed run, which is what a repeated number field gets by default. Both read back
 * the same, but only this one is the same bytes, so a file survives a round trip unchanged. This brings
 * the placeholders an earlier run saved into line; it works on the schema as JSON because protobufjs
 * fixes a field's encoding when the schema is resolved, which is too late to change.
 * @param {Record<string, any>} json
 */
export function writeUnpacked(json) {
  const NUMBER = new Set(["uint64", "fixed64", "fixed32"]);
  const walk = (o) => {
    for (const [name, f] of Object.entries(o.fields ?? {})) {
      if (name.startsWith("_unknown_") && f.rule === "repeated" && NUMBER.has(f.type)) f.options = { ...f.options, packed: false };
    }
    for (const n of Object.values({ ...o.nested, ...o.types })) walk(n);
  };
  walk(json);
  return json;
}
