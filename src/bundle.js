import zlib from "node:zlib";
import JSZip from "jszip";

// ProPresenter bundles (.probundle, .protheme) are zips. Reading and writing them.
//
// READ BY WALKING THE LOCAL HEADERS, not the central directory. ProPresenter writes a central
// directory whose stated length is 98 bytes longer than what is there - every export seen so far,
// bundles and themes alike - and a strict reader (Python's zipfile, JSZip) refuses the whole file.
// Each entry's own header is intact, so reading those front to back gets every file.

/** @typedef {{ name: string, data: Buffer }} BundleEntry */

/**
 * Every entry of a bundle, in file order.
 * @param {Buffer} buf
 * @param {{ maxEntryBytes?: number }} [opts] refuse an entry larger than this, before inflating it
 * @returns {BundleEntry[]}
 */
export function readBundle(buf, opts = {}) {
  const out = [];
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const flags = buf.readUInt16LE(p + 6);
    const method = buf.readUInt16LE(p + 8);
    let size = buf.readUInt32LE(p + 18);
    let unpacked = buf.readUInt32LE(p + 22);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString("utf8");
    const start = p + 30 + nameLen + extraLen;
    // Zip64: the real sizes are in the extra field when the 32-bit ones are saturated.
    if (size === 0xffffffff || unpacked === 0xffffffff) {
      const extra = buf.subarray(p + 30 + nameLen, start);
      for (let e = 0; e + 4 <= extra.length;) {
        const id = extra.readUInt16LE(e), len = extra.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let at = e + 4;
          if (unpacked === 0xffffffff) { unpacked = Number(extra.readBigUInt64LE(at)); at += 8; }
          if (size === 0xffffffff) size = Number(extra.readBigUInt64LE(at));
          break;
        }
        e += 4 + len;
      }
    }
    if (flags & 0x08) throw new Error(`zip entry ${name} uses a data descriptor, which this reader does not handle`);
    if (start + size > buf.length) throw new Error(`zip entry ${name} runs past the end of the file`);
    if (opts.maxEntryBytes && Math.max(size, unpacked) > opts.maxEntryBytes) throw new Error(`zip entry ${name} is larger than ${opts.maxEntryBytes} bytes`);
    const raw = buf.subarray(start, start + size);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, opts.maxEntryBytes ? { maxOutputLength: opts.maxEntryBytes } : {});
    else throw new Error(`zip method ${method}`);
    out.push({ name, data });
    p = start + size;
  }
  return out;
}

/** Whether these bytes start like a zip (a .probundle or .protheme) rather than a bare .pro. */
export const isZip = (buf) => buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;

/**
 * Write a bundle the way ProPresenter writes one: stored rather than compressed (the media is
 * already compressed, and it is what ProPresenter itself does), the .pro at the root, and each media
 * file under the absolute path its URL names.
 * @param {BundleEntry[]} entries
 * @returns {Promise<Buffer>}
 */
export async function writeBundle(entries) {
  const zip = new JSZip();
  for (const e of entries) zip.file(e.name, e.data, { binary: true, createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE", platform: "UNIX" });
}
