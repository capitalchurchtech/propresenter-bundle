// propresenter-bundle: read, check and edit ProPresenter 7 files (.pro, .probundle, .protheme).
// Unofficial; see README.md.
export { readBundle, writeBundle, isZip } from "./bundle.js";
export { markdownRuns, linkRuns } from "./runs.js";
export { readRangeFont, writeRangeFont, boldOf, buildRtf, buildRanges, plainText, readableText, listRtf } from "./rtf.js";
export { findUnknownFields, addPlaceholders, writeUnpacked } from "./placeholders.js";
export { loadSchema, decodePresentation, encodePresentation, checkPresentationBytes } from "./schema.js";
export { tableMetrics, fallbackMetrics } from "./metrics.js";
export { createGeometry, englishBreaks, linePitch, BOX_PAD, LINE_PADDING } from "./geometry.js";
export { createRoles, defaultRoleRules } from "./roles.js";
export {
  uuid, freshCopy, rtfSize, textOf, setText, mediaUrl, setImage, ELEMENT_NAMES, STACK, tidyElements,
  fitSpeakerBox, roleFor, repointBackgrounds, tidyActions, elementsOf, renameElement,
} from "./elements.js";
export { openFile, toModel, mediaFilesOf, readPresentationFile, linksOf, showsOwnLabel } from "./model.js";
export { WORKSPACE_PARTS, readWorkspacePart, readPlaylistFile } from "./workspace.js";
export { mediaInfo, mediaObject, mediaAction, mediaBox, workspaceOf, mediaEntryName } from "./media.js";
export { parseColor, setTextColor, setAlignment, setVerticalAlignment, setTextFit, setCapitals, setFont, setBoxStyle, arrangeBox, setLineSpacing, notesOf, setNotes, setTextOutline, setTextShadow, setFeather, setMargins, setList } from "./format.js";
export { openTheme, decodeTheme, encodeTheme, checkThemeBytes, themeModel, readThemeFile, writeTheme, themeWorkspace, themeSlideAsCue } from "./theme.js";
export { diffModels } from "./diff.js";
export { checkFile } from "./check.js";
