// propresenter-bundle (working name): read, check and edit ProPresenter 7 files (.pro, .probundle).
// Unofficial; see README.md.
export { readBundle, writeBundle, isZip } from "./bundle.js";
export { markdownRuns, linkRuns } from "./runs.js";
export { readRangeFont, writeRangeFont, boldOf, buildRtf, buildRanges, plainText, readableText } from "./rtf.js";
export { findUnknownFields, addPlaceholders, writeUnpacked } from "./placeholders.js";
export { loadSchema, decodePresentation, encodePresentation, checkPresentationBytes } from "./schema.js";
export { tableMetrics, fallbackMetrics } from "./metrics.js";
export { createGeometry, englishBreaks, linePitch, BOX_PAD, LINE_PADDING } from "./geometry.js";
export { createRoles, defaultRoleRules } from "./roles.js";
export {
  uuid, freshCopy, rtfSize, textOf, setText, mediaUrl, setImage, ELEMENT_NAMES, STACK, tidyElements,
  fitSpeakerBox, roleFor, repointBackgrounds, tidyActions,
} from "./elements.js";
export { openFile, toModel, mediaFilesOf, readPresentationFile } from "./model.js";
export { diffModels } from "./diff.js";
export { checkFile } from "./check.js";
