import { plainText } from "./rtf.js";

// WHAT A BOX IS, from what is in it. Element names in a hand-built theme are not reliable ("Image 0",
// a link line named after the sample words it was made with), so a box is known by its font, its
// content and its shape instead.
//
// THE RULES ARE ONE CHURCH'S. Which font is the kicker, which face is a title, how wide a full-frame
// panel is: each church's theme answers differently, so the rules are data (a pack's), with plain
// defaults here.

/** @typedef {"title" | "kicker" | "description" | "link" | "qr" | "photo" | "panel" | "highlight" | "other"} Role */

/**
 * @typedef {object} RoleRules
 * @property {number} panelMinWidth an image at least this wide is a full-frame panel
 * @property {number} qrMaxWidth a near-square image narrower than this is a QR code
 * @property {number} qrSquareTolerance how far from square a QR may be, as a fraction of its longer side
 * @property {{ role: Role, in: "rtf" | "font" | "rtfOrFont" | "words", pattern: string, flags?: string }[]} text
 *   tried in order on a box with words; the first that matches names it
 * @property {Role} otherText what a box with words is when no rule matches
 */

/** @type {RoleRules} */
export const defaultRoleRules = {
  panelMinWidth: 1900,
  qrMaxWidth: 420,
  qrSquareTolerance: 0.12,
  text: [
    { role: "title", in: "rtfOrFont", pattern: "Medium" },
    { role: "link", in: "words", pattern: "\\.(com|org|net)\\b|@|web address|email", flags: "i" },
  ],
  otherText: "description",
};

const rtfOf = (x) => (x.text?.rtf_data ? Buffer.from(x.text.rtf_data).toString("latin1") : "");

/**
 * A role finder for one set of rules. Each element's role is decided once, from the theme's own
 * content, before any words are replaced: new words (a web address typed into a description, say)
 * must not change what a box is.
 * @param {Partial<RoleRules>} [rules]
 */
export function createRoles(rules = {}) {
  const r = { ...defaultRoleRules, ...rules };
  const matchers = r.text.map((t) => ({ ...t, re: new RegExp(t.pattern, t.flags ?? "") }));
  const cache = new WeakMap();

  /** @returns {Role} */
  function decideRole(el) {
    const x = el.element;
    const w = x.bounds?.size?.width ?? 0, h = x.bounds?.size?.height ?? 0;
    if (x.fill?.media) {
      if (w >= r.panelMinWidth) return "panel";
      return Math.abs(w - h) / Math.max(w, h) < r.qrSquareTolerance && w < r.qrMaxWidth ? "qr" : "photo";
    }
    const rtf = rtfOf(x);
    const words = plainText(rtf).trim();
    const font = x.text?.attributes?.font?.name ?? "";
    if (!words) return x.fill?.enable ? "highlight" : "other";
    for (const m of matchers) {
      const hit = m.in === "rtf" ? m.re.test(rtf) : m.in === "font" ? m.re.test(font) : m.in === "words" ? m.re.test(words) : m.re.test(rtf) || m.re.test(font);
      if (hit) return m.role;
    }
    return r.otherText;
  }

  /** @returns {Role} */
  function roleOf(el) {
    let role = cache.get(el);
    if (!role) { role = decideRole(el); cache.set(el, role); }
    return role;
  }

  return { roleOf, decideRole, rules: r };
}
