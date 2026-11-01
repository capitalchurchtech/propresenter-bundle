// A workspace's own files, read only: invented ones made with the schema, as ProPresenter would write them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSchema, readWorkspacePart, WORKSPACE_PARTS } from "../src/index.js";

const encode = (type, obj) => { const T = loadSchema().root.lookupType(type); return Buffer.from(T.encode(T.fromObject(obj)).finish()); };
const uid = (n) => ({ string: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` });

test("each part names the file it lives in, under the workspace's content folder", () => {
  assert.equal(WORKSPACE_PARTS.macros, "Configuration/Macros");
  assert.equal(WORKSPACE_PARTS.playlists, "Playlists/Library");
  assert.ok(Object.values(WORKSPACE_PARTS).every((f) => /^(Configuration|Playlists)\//.test(f)), "never the state folder");
});

test("macros with their collections, labels, groups and Looks with their screens", () => {
  const m = readWorkspacePart("macros", encode("rv.data.MacrosDocument", { macros: [{ uuid: uid(1), name: "Lower Thirds", color: { red: 0, green: 1, blue: 0, alpha: 1 } }], macro_collections: [{ uuid: uid(2), name: "Service", items: [{ macro_id: uid(1) }, { macro_id: uid(9) }] }] }));
  assert.deepEqual(m.macros, [{ name: "Lower Thirds", id: uid(1).string, color: "#00ff00", actions: 0 }]);
  assert.deepEqual(m.collections[0].macros, ["Lower Thirds", uid(9).string], "a macro the list no longer has shows its id");
  assert.deepEqual(readWorkspacePart("labels", encode("rv.data.ProLabelsDocument", { labels: [{ text: "Chorus" }] })).labels, [{ text: "Chorus", color: null }]);
  const looks = readWorkspacePart("looks", encode("rv.data.ProPresenterWorkspace", { pro_screens: [{ uuid: uid(3), name: "Front" }], audience_looks: [{ uuid: uid(4), name: "Full", screen_looks: [{ pro_screen_uuid: uid(3) }] }] }));
  assert.deepEqual(looks.looks, [{ name: "Full", id: uid(4).string, screens: ["Front"] }]);
  assert.equal(looks.unknown, 0);
});

test("playlists as a tree of folders, with each item's kind and the presentation file it plays", () => {
  const r = readWorkspacePart("playlists", encode("rv.data.PlaylistDocument", { root_node: { uuid: uid(1), playlists: { playlists: [
    { uuid: uid(2), name: "Sundays", playlists: { playlists: [{ uuid: uid(3), name: "Week One", items: { items: [
      { uuid: uid(4), name: "Welcome", header: {} },
      { uuid: uid(5), name: "Song", presentation: { document_path: { local: { path: "Libraries/Default/Song.pro" } } }, is_hidden: true },
    ] } }] } },
  ] } } }));
  assert.deepEqual(r.playlists[0].children[0].items.map((i) => [i.kind, i.name, i.file ?? null, i.hidden ?? false]), [["header", "Welcome", null, false], ["presentation", "Song", "Song.pro", true]]);
});

test("a field a newer ProPresenter added is counted, and the rest still read", () => {
  const buf = Buffer.concat([encode("rv.data.ProLabelsDocument", { labels: [{ text: "Verse" }] }), Buffer.from([0xc8, 0x8c, 0x04, 0x07])]);
  const r = readWorkspacePart("labels", buf);
  assert.equal(r.unknown, 1);
  assert.deepEqual(r.labels.map((l) => l.text), ["Verse"]);
  assert.throws(() => readWorkspacePart("database", buf), /No workspace part database/);
});
