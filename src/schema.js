import { createRequire } from "node:module";
import protobuf from "protobufjs";
import { addPlaceholders, findUnknownFields } from "./placeholders.js";

// The community schema (greyshirtguy/ProPresenter7-Proto's autogen-proto, from ProPresenter 21.4, MIT, in proto/),
// compiled to proto.json by scripts/compile-schema.js, with Google's protobuf types (BSD-3-Clause): see NOTICE.
// UNOFFICIAL: Renewed Vision does not publish or support it. A newer ProPresenter can write fields it lacks; those
// are found (findUnknownFields) and carried through, never silently dropped.

const require = createRequire(import.meta.url);
const PROTO_JSON = require("./proto.json");

/**
 * A fresh copy of the schema. Fresh because `addPlaceholders` changes the types it is given, and one
 * file's unknown fields should not leak into how the next file is read.
 */
export function loadSchema() {
  const root = protobuf.Root.fromJSON(PROTO_JSON);
  return { root, Presentation: root.lookupType("rv.data.Presentation"), ThemeDocument: root.lookupType("rv.data.Template.Document") };
}

export const OBJECT_OPTIONS = { longs: String, enums: Number, bytes: Buffer, defaults: false };

/**
 * A .pro's bytes as a plain object, plus what the schema could not read. Unknown fields are carried as
 * placeholders, so `encodePresentation` on the result writes them back.
 * @param {Uint8Array} buf
 */
export function decodePresentation(buf) {
  const s = loadSchema();
  const unknown = findUnknownFields(s.Presentation, buf);
  if (unknown.length) addPlaceholders(s.root, s.Presentation, buf);
  const doc = s.Presentation.toObject(s.Presentation.decode(buf), OBJECT_OPTIONS);
  return { doc, unknown, schema: s };
}

/** Bytes for a presentation object decoded with the same schema. */
export function encodePresentation(schema, doc) {
  return Buffer.from(schema.Presentation.encode(schema.Presentation.fromObject(doc)).finish());
}

/**
 * THE CHECK FOR A LIBRARY FILE. Not a byte round trip: ProPresenter's own saves re-encode about one
 * byte longer per slide through this schema while decoding identically. Instead (a) the raw walk finds
 * no field the schema lacks, and (b) decode, encode, decode gives equal objects.
 * @param {Uint8Array} buf
 * @returns {{ ok: boolean, unknown: ReturnType<typeof findUnknownFields>, stable: boolean, error?: string }}
 */
export function checkPresentationBytes(buf) {
  try {
    const { doc, unknown, schema } = decodePresentation(buf);
    const again = schema.Presentation.toObject(schema.Presentation.decode(encodePresentation(schema, doc)), OBJECT_OPTIONS);
    const stable = deepEqual(doc, again);
    return { ok: unknown.length === 0 && stable, unknown, stable };
  } catch (err) {
    return { ok: false, unknown: [], stable: false, error: err.message };
  }
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b);
  if (a instanceof Uint8Array && b instanceof Uint8Array) return Buffer.from(a).equals(Buffer.from(b));
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}
