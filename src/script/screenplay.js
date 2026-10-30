// A screenplay-style script (a PDF's text) turned into the form the parser reads everywhere else:
// "NAME: words" for dialogue, and a line wrapped in literal asterisks for a stage direction.
//
//   BLACKOUT. Gentle music plays as a book appears on                  <- a direction, hard-wrapped
//   the screen: The Baker and the Bell.
//                       NARRATOR (V.O.)                               <- a character cue, in capitals
//             Once upon a time, in a town by                          <- dialogue, hard-wrapped narrower
//             the river, there lived a baker                          <- a line is a continuation
//   A picture of the bakery appears on screen.                         <- a direction again
//
// TWO WAYS TO TELL DIALOGUE FROM A DIRECTION, in order of how far they can be trusted:
//   1. INDENTATION, when the text still has it (read off the PDF with its layout): directions at the left
//      margin, dialogue indented, cues indented furthest. Exact.
//   2. WITHOUT IT (text copied out of a PDF reader loses its indentation): a cue is a short capitalised line
//      that recurs; dialogue wraps narrower than a direction, so a line longer than the dialogue's own width
//      is a direction, as is one that opens like one (BLACKOUT, LIGHTS UP). A SHORT direction right after a
//      line of dialogue ("The crowd runs off.") cannot be told from dialogue this way and joins it; the
//      beats list is where that is fixed.
// Pure, no dependencies, so a page and a server read a script the same way.

const CUE = /^([A-Z][A-Z0-9 &'’#.-]{0,30}?)(?:\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT['’]D|CONT'D)\))?$/;
const PAGE_NUMBER = /^\s*\d+\.?\s*$/;
const PAGE_MARK = /^<<<PAGE \d+>>>$/;
// A direction that opens like one, whatever width it was written at.
const STAGE_WORD = /^(BLACKOUT|LIGHTS?\b|SFX|MUSIC|SOUND|ENTER|EXIT|CUT TO|FADE|SMOKE)/;

const nameOf = (cue) => cue.replace(/\s*\([^)]*\)\s*$/, "").trim();
/** A cue as the name the parser reads: "SOLDIER 1" is "SOLDIER #1", the one form of number a speaker's name takes. */
const speakerName = (cue) => nameOf(cue).replace(/\s+(\d{1,2})$/, " #$1");
const isCue = (l) => {
  const t = l.trim();
  // A cue has letters, no sentence punctuation to end it, and is not a "A - B - C" page header.
  return CUE.test(t) && /[A-Z]{2}/.test(t) && !/[.!?]$/.test(t.replace(/\((?:V\.O\.|O\.S\.|O\.C\.|CONT['’]D)\)$/, "").trim()) && !/ - /.test(t);
};
const endsSentence = (s) => /[.!?…"”’')]$/.test(s.trim());

function percentile(xs, p) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

const isHeader = (s) => s === s.toUpperCase() && / - /.test(s);
/** A line that opens a new direction rather than carrying the last one on: capital start after a full stop. */
const isNewDirection = (s, byIndent) => byIndent || /^[A-Z]/.test(s);

/**
 * The script in the parser's own form, or null when this does not look like a screenplay (so the caller reads
 * it as it was written). Null is the common case: it only fires when capitalised cue lines recur and "NAME:"
 * lines do not.
 * @param {string} text
 * @returns {string | null}
 */
export function fromScreenplay(text) {
  const raw = text.replace(/\r/g, "").replace(/\t/g, "    ").split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() && !PAGE_NUMBER.test(l) && !PAGE_MARK.test(l.trim()))
    .map((l) => ({ indent: l.length - l.trimStart().length, text: l.trim() }));
  if (raw.length < 6) return null;

  // Lines that already read "NAME: words": a name is capitalised, so a wrapped line like "the screen: The Baker"
  // is not one. A screenplay is chosen only when cue lines clearly outnumber them.
  const SPEAKS = /^\**(?:[A-Z][A-Za-z.’'-]*)(?: [A-Z][A-Za-z.’'-]*){0,4}\*{0,2}\s*:\*{0,2}\s/;
  const colonSpeakers = raw.filter((l) => SPEAKS.test(l.text)).length;

  // Candidate cues, and which of them recur: a name said once is more likely a shouted line or a title. An
  // occurrence counts only when words follow it, so a shouted "NO" beside another capitalised line is not one.
  const seen = new Map();
  raw.forEach((l, i) => {
    if (isCue(l.text) && raw[i + 1] && !isCue(raw[i + 1].text)) seen.set(nameOf(l.text), (seen.get(nameOf(l.text)) ?? 0) + 1);
  });
  // "TOWNSPERSON #1" and "NARRATOR (V.O.)" are cues the first time they appear; a plain name has to recur.
  const marked = new Set(raw.filter((l) => isCue(l.text) && /[#(]/.test(l.text)).map((l) => nameOf(l.text)));
  const names = new Set([...seen].filter(([k, n]) => n >= 2 || marked.has(k)).map(([k]) => k));
  if (names.size < 2) return null;
  const cueLines = raw.filter((l) => names.has(nameOf(l.text)) && isCue(l.text)).length;
  if (cueLines < 4 || cueLines <= colonSpeakers) return null;

  // Indentation, when the text has it: three or more levels, or at least a cue level beyond the rest.
  const indents = [...new Set(raw.map((l) => l.indent))].sort((a, b) => a - b);
  const byIndent = indents.length >= 3 && raw.filter((l) => names.has(nameOf(l.text)) && isCue(l.text)).every((l) => l.indent === indents[indents.length - 1] || l.indent > indents[0]);
  const left = indents[0];
  const cueIndent = Math.max(...raw.filter((l) => isCue(l.text) && names.has(nameOf(l.text))).map((l) => l.indent));

  // With indentation a cue is whatever is a cue at the cue indent; without it, a name that recurs or is marked.
  const cueAt = (l) => isCue(l.text) && (byIndent ? l.indent >= cueIndent - 2 : names.has(nameOf(l.text)));

  // Without indentation: how wide dialogue is, from the lines that follow a cue.
  const dialogueWidths = [];
  raw.forEach((l, i) => { if (cueAt(l)) for (let j = i + 1; j < raw.length && !cueAt(raw[j]) && dialogueWidths.length < 4000; j++) if (raw[j].text.length <= 50) dialogueWidths.push(raw[j].text.length); else break; });
  const wrap = percentile(dialogueWidths, 0.9);
  const isDirection = (l, afterDialogue) => {
    if (byIndent) return l.indent <= left + 2;
    if (STAGE_WORD.test(l.text)) return true;
    // Wider than the dialogue ever is, and it opens a sentence rather than carrying one on.
    return afterDialogue && wrap > 0 && l.text.length > wrap + 4;
  };

  const out = [];
  let speaker = null, buf = [], dir = [];
  const flushDialogue = () => { if (speaker && buf.length) out.push(`${speaker}: ${buf.join(" ")}`); buf = []; };
  // A tech note on a line of its own ({Lights: Up}) is not a direction for the actors: it goes through untouched.
  const flushDirection = () => {
    if (dir.length) { const t = dir.join(" "); out.push(/^\{[^}]*\}$/.test(t) ? t : `\\*${t}\\*`); }
    dir = [];
  };

  raw.forEach((l, i) => {
    // A page header ("SUMMER CAMP - NIGHT 1 - OPENING") opens the show: left as plain words, which the parser makes a Title.
    if (i === 0 && isHeader(l.text)) { out.push(l.text); return; }
    if (cueAt(l)) { flushDialogue(); flushDirection(); speaker = speakerName(l.text); return; }
    if (speaker) {
      if (isDirection(l, true)) { flushDialogue(); speaker = null; dir.push(l.text); return; }
      buf.push(l.text);
      return;
    }
    // Before anyone has spoken, or after a direction: a direction. A new one starts after a full stop.
    if (dir.length && endsSentence(dir[dir.length - 1]) && isNewDirection(l.text, byIndent)) flushDirection();
    dir.push(l.text);
  });
  flushDialogue(); flushDirection();
  return out.join("\n");
}
