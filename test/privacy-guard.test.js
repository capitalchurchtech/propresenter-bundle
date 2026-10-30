// THE PRIVACY GUARD. This package is public and must never carry a church's data: its themes, its
// slides, its pictures, its licensed fonts' metrics, the names of its people. These tests fail the
// build when such a thing is committed by accident.
//
// 1. No presentation, theme, bundle, picture or font file anywhere except the synthetic fixtures,
//    and the fixtures are exactly what scripts/make-fixtures.js writes.
// 2. No configured private string anywhere in the repo. The list itself is private, so it is NOT in
//    the repo: one string per line in the file named by PROBUNDLE_PRIVATE_STRINGS, or by default
//    ~/.config/propresenter-bundle/private-strings.txt. With no list, that test is skipped and says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = path.join(ROOT, "test", "fixtures");
const SKIP_DIRS = new Set([".git", "node_modules"]);
const CHURCH_DATA = /\.(pb|pro|probundle|protheme|proplaylist|pro6|pro5|png|jpe?g|gif|heic|tiff?|webp|bmp|mov|mp4|m4v|ttf|otf|ttc|dfont|woff2?)$/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test("no presentation, theme, picture or font file outside the synthetic fixtures", () => {
  const found = walk(ROOT).filter((f) => CHURCH_DATA.test(f) && !f.startsWith(FIXTURES + path.sep));
  assert.deepEqual(found.map((f) => path.relative(ROOT, f)), [], "church data, or something that looks like it, is in the repo");
});

test("the fixtures are exactly what the fixtures script makes from invented words", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fixtures-"));
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "make-fixtures.js"), tmp], { stdio: "ignore" });
    const made = fs.readdirSync(tmp).sort();
    assert.deepEqual(fs.readdirSync(FIXTURES).sort(), made, "a file in test/fixtures that the script does not make");
    for (const f of made) assert.ok(fs.readFileSync(path.join(tmp, f)).equals(fs.readFileSync(path.join(FIXTURES, f))), `${f} differs from what the script makes`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const listPath = process.env.PROBUNDLE_PRIVATE_STRINGS || path.join(os.homedir(), ".config", "propresenter-bundle", "private-strings.txt");
const privateStrings = fs.existsSync(listPath)
  ? fs.readFileSync(listPath, "utf8").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"))
  : null;

test("no configured private string anywhere in the repo", { skip: privateStrings ? false : `no private-strings list at ${listPath}` }, () => {
  const hits = [];
  for (const f of walk(ROOT)) {
    const body = fs.readFileSync(f).toString("latin1").toLowerCase();
    for (const s of privateStrings) if (body.includes(s.toLowerCase())) hits.push(`${path.relative(ROOT, f)}: private string number ${privateStrings.indexOf(s) + 1} on the list`);
  }
  // The message names the file and the entry number, never the string itself.
  assert.deepEqual(hits, []);
});
