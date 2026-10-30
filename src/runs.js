// Text as runs of plain and bold. No dependencies, so a browser can measure lines exactly as the
// bundle will.

/** @typedef {{ text: string, bold: boolean }} Run */

/**
 * **bold** markers to runs.
 * @param {string} text
 * @returns {Run[]}
 */
export function markdownRuns(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) =>
    p.startsWith("**") && p.endsWith("**") ? { text: p.slice(2, -2), bold: true } : { text: p, bold: false });
}

/**
 * A link line as it reads on a wall, "example.org/events": the host plain, the page bold. For an email
 * address the name before the @ is the part to read, so it is the bold part.
 * @param {string} link
 * @returns {Run[]}
 */
export function linkRuns(link) {
  const e = /^([^@\s]+)(@.+)$/.exec(link.trim());
  if (e) return [{ text: e[1], bold: true }, { text: e[2], bold: false }];
  const m = /^([^/]+\/)(.+)$/.exec(link.trim());
  return m ? [{ text: m[1], bold: false }, { text: m[2], bold: true }] : [{ text: link.trim(), bold: false }];
}
