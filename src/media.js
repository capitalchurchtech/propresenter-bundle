import { uuid, freshCopy, mediaUrl } from "./elements.js";
import { imageFormat, CODEC } from "./script/compose.js";

// Pictures, videos and sound put on a slide: as a box (a picture box), or as a media action on the slide's
// background or foreground layer. Written the way ProPresenter writes them: the file under the workspace's
// Media/Assets, by the library root, as ProPresenter's own bundles point at it.
//
// Where the file already holds a media item of the same kind, the new one is a copy of it repointed, so it
// keeps ProPresenter's own settings for that kind (a video's transport, a picture's alpha). Otherwise it is
// built from the fields ProPresenter writes; a video's size and a clip's length, which this does not read
// from the file, are left for ProPresenter to read when it loads the file.

const IMAGE = ["png", "jpg", "jpeg", "gif", "tif", "tiff", "heic", "bmp", "webp"];
const VIDEO = ["mp4", "m4v", "mov"];
const AUDIO = ["mp3", "m4a", "aac", "wav", "aif", "aiff"];

/** A picture's size from its own header (PNG, JPEG, GIF), or null. */
function pictureSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 10 && buf.toString("latin1", 0, 3) === "GIF") return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let p = 2; p + 9 < buf.length;) {
      if (buf[p] !== 0xff) { p++; continue; }
      const marker = buf[p + 1];
      const len = buf.readUInt16BE(p + 2);
      // A start-of-frame marker holds the size; C4, C8 and CC are not frames.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: buf.readUInt16BE(p + 7), h: buf.readUInt16BE(p + 5) };
      p += 2 + len;
    }
  }
  return null;
}

/**
 * What a media file is, from its name and bytes: picture, video or sound, ProPresenter's format name for
 * it, and a picture's size when its header says.
 * @param {string} file the file's name
 * @param {Buffer} [buf] its bytes
 */
export function mediaInfo(file, buf) {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const kind = IMAGE.includes(ext) ? "image" : VIDEO.includes(ext) ? "video" : AUDIO.includes(ext) ? "audio" : null;
  if (!kind) throw new Error(`${file} is not a picture, video or sound ProPresenter takes (${[...IMAGE, ...VIDEO, ...AUDIO].join(", ")}).`);
  const size = kind === "image" && buf ? pictureSize(buf) : null;
  // ProPresenter 21 writes "JPG" in capitals and png and webp not: imageFormat keeps its spelling.
  return { file, kind, format: kind === "image" ? imageFormat(file) : CODEC[ext] ?? ext, w: size?.w ?? null, h: size?.h ?? null };
}

const kindOf = (media) => (media?.image ? "image" : media?.video ? "video" : media?.audio ? "audio" : null);

/**
 * A ProPresenter Media for a file: a copy of `like` (an existing Media of the same kind) repointed, or one
 * built from scratch.
 * @param {ReturnType<typeof mediaInfo>} info
 * @param {string} workspace the workspace folder the URL is written under
 * @param {any} [like]
 */
export function mediaObject(info, workspace, like) {
  const url = mediaUrl(info.file, workspace);
  const size = info.w && info.h ? { width: info.w, height: info.h } : null;
  const m = like && kindOf(like) === info.kind ? freshCopy(like) : { [info.kind]: {} };
  m.uuid = uuid();
  m.url = url;
  m.metadata = { ...(m.metadata ?? {}), format: info.format };
  delete m.metadata.artist; // the copied file's tag, not this one's
  delete m.metadata.manufacture_name;
  const body = m[info.kind];
  body.file = { local_url: mediaUrl(info.file, workspace) };
  if (info.kind === "image") {
    body.drawing = { alpha_type: 1, ...(body.drawing ?? {}), crop_enable: false, crop_insets: {}, ...(size ? { natural_size: size } : {}) };
    if (!size) delete body.drawing.natural_size; // read by ProPresenter when it loads the file
  }
  if (info.kind === "video") {
    body.drawing = { ...(body.drawing ?? {}) };
    delete body.drawing.natural_size;
  }
  if (body.transport) { delete body.transport.out_point; delete body.transport.end_point; } // the copied clip's length
  return m;
}

const LAYERS = { background: 0, foreground: 1 };

/**
 * A media action: the file on the slide's background layer (it stays until something replaces it) or its
 * foreground layer (it ends at the next slide). A sound plays on its own; its layer is ignored.
 */
export function mediaAction(info, workspace, { layer = "background", like } = {}) {
  if (!(layer in LAYERS)) throw new Error(`A media layer is background or foreground, not ${layer}.`);
  const element = mediaObject(info, workspace, like?.media?.element);
  const action = like && kindOf(like.media?.element) === info.kind ? freshCopy(like) : { isEnabled: true, type: 2, media: {} };
  action.uuid = uuid();
  delete action.duration; // the copied clip's length
  action.media = { ...action.media, element, ...(info.kind === "audio" ? {} : { layer_type: LAYERS[layer] }) };
  if (info.kind === "audio") delete action.media.layer_type;
  return action;
}

/** A picture or video box on a slide, at `bounds` (slide pixels), filled with the file. */
export function mediaBox(info, workspace, { name, bounds, like } = {}) {
  if (info.kind === "audio") throw new Error("A sound has no picture to put in a box: add it as a media action.");
  const b = bounds ?? { x: 0, y: 0, width: info.w ?? 1920, height: info.h ?? 1080 };
  return {
    element: {
      uuid: uuid(), name: name || info.file.replace(/\.[^.]+$/, ""), opacity: 1,
      bounds: { origin: { x: b.x, y: b.y }, size: { width: b.width, height: b.height } },
      fill: { enable: true, media: mediaObject(info, workspace, like) },
    },
  };
}

/**
 * The workspace folder a file's media already points into (from any media URL in it), or null. New media
 * goes under the same one, so it sits beside the rest when ProPresenter imports the bundle.
 */
export function workspaceOf(doc) {
  const find = (v) => {
    if (!v || typeof v !== "object") return null;
    if (typeof v.absolute_string === "string" && v.local?.root === 10 && v.local.path?.startsWith("Media/")) {
      const abs = decodeURI(v.absolute_string.replace(/^file:\/\//, ""));
      const at = abs.lastIndexOf(`/${v.local.path}`);
      if (at > 0) return abs.slice(0, at);
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) { if (x instanceof Uint8Array) continue; const f = find(x); if (f) return f; }
    return null;
  };
  return find(doc);
}

/** The name a media file goes under in a bundle: the absolute path its URL names, as ProPresenter's exports have it. */
export const mediaEntryName = (file, workspace) => `${workspace}/Media/Assets/${file}`;
