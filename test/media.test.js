// Media on a slide: a picture's size from its header, a picture or video box, background and foreground media
// actions, built from scratch or copied from one of the same kind so ProPresenter's own settings carry over.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mediaInfo, mediaAction, mediaBox, workspaceOf, mediaEntryName, decodePresentation, encodePresentation, checkPresentationBytes, toModel } from "../src/index.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const WS = "/Users/example/Library/Application Support/RenewedVision/ProPresenter/UserWorkspaces/Example";

test("what a file is: kind, ProPresenter's format name, and a picture's size from its own header", () => {
  assert.deepEqual(mediaInfo("dot.png", fs.readFileSync(path.join(FIX, "dot.png"))), { file: "dot.png", kind: "image", format: "png", w: 2, h: 2 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x04, 0x38, 0x07, 0x80, 3]);
  assert.deepEqual([mediaInfo("a.jpg", jpeg).format, mediaInfo("a.jpg", jpeg).w, mediaInfo("a.jpg", jpeg).h], ["JPG", 1920, 1080]);
  assert.deepEqual([mediaInfo("clip.mp4").kind, mediaInfo("clip.mp4").format, mediaInfo("hymn.mp3").kind], ["video", "h264", "audio"]);
  assert.throws(() => mediaInfo("notes.docx"), /not a picture, video or sound/);
});

test("background and foreground media actions, and a sound with no layer", () => {
  const png = mediaInfo("dot.png", fs.readFileSync(path.join(FIX, "dot.png")));
  const bg = mediaAction(png, WS);
  assert.deepEqual([bg.type, bg.media.layer_type, bg.media.element.url.local], [2, 0, { root: 10, path: "Media/Assets/dot.png" }]);
  assert.deepEqual(bg.media.element.image.drawing.natural_size, { width: 2, height: 2 });
  assert.equal(mediaAction(png, WS, { layer: "foreground" }).media.layer_type, 1);
  assert.equal(mediaAction(mediaInfo("hymn.mp3"), WS).media.layer_type, undefined);
  assert.throws(() => mediaAction(png, WS, { layer: "middle" }), /background or foreground/);
  assert.equal(mediaEntryName("dot.png", WS), `${WS}/Media/Assets/dot.png`);
});

test("a new media item copies one of its kind already in the file, repointed, keeping its settings", () => {
  const { doc, schema } = decodePresentation(fs.readFileSync(path.join(FIX, "sample-fixed.pro")));
  const like = doc.cues.flatMap((c) => c.actions).find((a) => a.media);
  like.media.element.metadata = { ...like.media.element.metadata, artist: "someone" };
  const action = mediaAction(mediaInfo("new.png", fs.readFileSync(path.join(FIX, "dot.png"))), WS, { like });
  assert.notEqual(action.uuid.string, like.uuid.string);
  assert.equal(action.media.element.metadata.artist, undefined, "the copied file's tag is not carried");
  assert.match(workspaceOf(doc), /^\/Users\/example\/.*\/Example$/, "the workspace the file's media already points into");

  // On a slide, with a picture box too, the presentation still passes its check and reads the new media.
  const cue = doc.cues[0];
  cue.actions.push(action);
  cue.actions.find((a) => a.slide).slide.presentation.base_slide.elements.unshift(mediaBox(mediaInfo("new.png", fs.readFileSync(path.join(FIX, "dot.png"))), WS, { name: "Logo", bounds: { x: 10, y: 10, width: 200, height: 200 } }));
  assert.equal(checkPresentationBytes(encodePresentation(schema, doc)).ok, true);
  const slide = toModel(doc).groups[0].slides[0];
  assert.deepEqual([slide.elements[0].name, slide.elements[0].kind, slide.elements[0].media], ["Logo", "image", "new.png"]);
  assert.ok(slide.media.some((m) => m.file === "new.png" && m.layer === 0));
  assert.throws(() => mediaBox(mediaInfo("hymn.mp3"), WS), /no picture to put in a box/);
});
