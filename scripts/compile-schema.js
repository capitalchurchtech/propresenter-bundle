// Compiles the schema in proto/ (greyshirtguy/ProPresenter7-Proto's autogen-proto, MIT; Google's standard
// types in proto/google, BSD-3) into src/proto.json, the form the package loads.
//
//   node scripts/compile-schema.js
//
// One change of this package's own: field 12 of a text range (CustomAttribute), which the schema names
// original_font, a Font inside the range's oneof, is kept as `_unknown_12`, repeated raw bytes, the form the
// package has always read and written font ranges in (rtf.js readRangeFont / writeRangeFont). The bytes on
// disk are the same either way. See NOTICE.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROTO = path.join(ROOT, "proto");

const root = new protobuf.Root();
root.resolvePath = (_origin, target) => path.join(PROTO, target);
const files = fs.readdirSync(PROTO).filter((f) => f.endsWith(".proto")).sort();
root.loadSync(files, { keepCase: true });
root.resolveAll();

const range = root.lookupType("rv.data.Graphics.Text.Attributes.CustomAttribute");
const font = range.fields.original_font;
if (!font || font.id !== 12) throw new Error("CustomAttribute field 12 is no longer original_font: check this script's one change against the schema.");
range.oneofs.Attribute.remove(font);
range.remove(font);
range.add(new protobuf.Field("_unknown_12", 12, "bytes", "repeated"));

fs.writeFileSync(path.join(ROOT, "src", "proto.json"), JSON.stringify(root.toJSON()));
console.log(`compiled ${files.length} files into src/proto.json`);
