import { loadSchema, OBJECT_OPTIONS } from "./schema.js";
import { findUnknownFields } from "./placeholders.js";
import { colorHex } from "./model.js";

// A ProPresenter workspace's own files, READ ONLY: the names a church's ProPresenter knows (macros, Looks,
// labels, groups, props, messages, timers, stage layouts, clear groups) and its playlists. They live in the
// workspace's content folder (UserWorkspaces/<name>/Configuration and /Playlists), never in the state folder
// beside it (Workspaces/<name>-<id>), which holds ProPresenter's database and is not read here.
//
// Nothing here writes. ProPresenter holds these files open and rewrites them as it runs, and a newer
// ProPresenter may hold fields this schema lacks: those are counted, and the rest is still read.

const id = (u) => u?.string ?? null;
const named = (list) => (list ?? []).map((x) => ({ name: x.name ?? "", id: id(x.uuid) }));
const fileName = (url) => (url?.local?.path ?? url?.relative_path ?? url?.absolute_string ?? "").split("/").pop().replace(/%20/g, " ") || null;

function playlistNode(node) {
  if (node.playlists) return { kind: "folder", name: node.name ?? "", id: id(node.uuid), children: (node.playlists.playlists ?? []).map(playlistNode) };
  return {
    kind: "playlist", name: node.name ?? "", id: id(node.uuid),
    items: (node.items?.items ?? []).map((it) => {
      const kind = it.header ? "header" : it.presentation ? "presentation" : it.placeholder ? "placeholder" : it.cue ? "cue" : "other";
      const pres = it.presentation ?? it.placeholder?.linked_data?.presentation;
      return {
        kind, name: it.name ?? "", id: id(it.uuid),
        ...(pres ? { file: fileName(pres.document_path), arrangement: id(pres.arrangement) } : {}),
        ...(it.is_hidden ? { hidden: true } : {}),
      };
    }),
  };
}

const PARTS = {
  macros: {
    file: "Configuration/Macros", type: "rv.data.MacrosDocument",
    read: (o) => {
      const byId = new Map((o.macros ?? []).map((m) => [id(m.uuid), m.name ?? ""]));
      return {
        macros: (o.macros ?? []).map((m) => ({ name: m.name ?? "", id: id(m.uuid), color: colorHex(m.color), actions: (m.actions ?? []).length })),
        collections: (o.macro_collections ?? []).map((c) => ({ name: c.name ?? "", id: id(c.uuid), macros: (c.items ?? []).map((i) => byId.get(id(i.macro_id)) ?? id(i.macro_id)) })),
      };
    },
  },
  looks: {
    file: "Configuration/Workspace", type: "rv.data.ProPresenterWorkspace",
    read: (o) => {
      const screen = new Map((o.pro_screens ?? []).map((s) => [id(s.uuid), s.name ?? ""]));
      const look = (l) => ({ name: l.name ?? "", id: id(l.uuid), screens: (l.screen_looks ?? []).map((s) => screen.get(id(s.pro_screen_uuid)) ?? id(s.pro_screen_uuid)) });
      return {
        screens: (o.pro_screens ?? []).map((s) => ({ name: s.name ?? "", id: id(s.uuid), type: s.screen_type ?? null })),
        looks: (o.audience_looks ?? []).map(look),
        live_look: o.live_audience_look ? look(o.live_audience_look) : null,
        masks: (o.masks ?? []).map((m) => m.name ?? ""),
      };
    },
  },
  labels: { file: "Configuration/Labels", type: "rv.data.ProLabelsDocument", read: (o) => ({ labels: (o.labels ?? []).map((l) => ({ text: l.text ?? "", color: colorHex(l.color) })) }) },
  groups: {
    file: "Configuration/Groups", type: "rv.data.ProGroupsDocument",
    read: (o) => ({ groups: (o.groups ?? []).map((g) => ({ name: g.name ?? "", id: id(g.uuid), color: colorHex(g.color), hot_key: g.hotKey?.code ?? null })) }),
  },
  props: {
    file: "Configuration/Props", type: "rv.data.PropDocument",
    read: (o) => {
      const byId = new Map((o.cues ?? []).map((c) => [id(c.uuid), c.name ?? ""]));
      return { props: named(o.cues), collections: (o.prop_collections ?? []).map((c) => ({ name: c.name ?? "", props: (c.items ?? []).map((i) => byId.get(id(i.prop_cue_uuid)) ?? id(i.prop_cue_uuid)) })) };
    },
  },
  messages: {
    file: "Configuration/Messages", type: "rv.data.MessageDocument",
    read: (o) => ({ messages: (o.messages ?? []).map((m) => ({ title: m.title ?? "", id: id(m.uuid), text: m.message_text ?? "", theme: m.template?.name ?? null, theme_slide: m.template?.slide_name ?? null })) }),
  },
  timers: {
    file: "Configuration/Timers", type: "rv.data.TimersDocument",
    read: (o) => ({ timers: (o.timers ?? []).map((t) => ({ name: t.name ?? "", id: id(t.uuid), kind: Object.keys(t.configuration ?? {})[0] ?? null, seconds: t.configuration?.countdown?.duration ?? null })) }),
  },
  stage_layouts: { file: "Configuration/Stage", type: "rv.data.Stage.Document", read: (o) => ({ stage_layouts: named(o.layouts) }) },
  clear_groups: { file: "Configuration/ClearGroups", type: "rv.data.ClearGroupsDocument", read: (o) => ({ clear_groups: named(o.groups) }) },
  playlists: { file: "Playlists/Library", type: "rv.data.PlaylistDocument", read: (o) => ({ playlists: o.root_node ? playlistNode(o.root_node).children ?? [] : [] }) },
};

/** The parts of a workspace this reads, and the file each lives in, relative to the workspace's folder. */
export const WORKSPACE_PARTS = Object.fromEntries(Object.entries(PARTS).map(([k, v]) => [k, v.file]));

/**
 * One part of a workspace, read from its file's bytes. `unknown` counts fields a newer ProPresenter wrote
 * that this schema lacks; what it does know is still read.
 * @param {keyof typeof PARTS} part
 * @param {Uint8Array} buf
 */
export function readWorkspacePart(part, buf) {
  const p = PARTS[part];
  if (!p) throw new Error(`No workspace part ${part}. The parts are: ${Object.keys(PARTS).join(", ")}.`);
  const T = loadSchema().root.lookupType(p.type);
  const unknown = findUnknownFields(T, buf).length;
  return { part, unknown, ...p.read(T.toObject(T.decode(buf), OBJECT_OPTIONS)) };
}
