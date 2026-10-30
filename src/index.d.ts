// Types for propresenter-bundle. Decoded ProPresenter messages are plain objects shaped by the
// community schema; they are typed `any` here rather than restated.
import type protobuf from "protobufjs";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Msg = any;

export interface BundleEntry { name: string; data: Buffer }
export function readBundle(buf: Buffer, opts?: { maxEntryBytes?: number }): BundleEntry[];
export function writeBundle(entries: BundleEntry[]): Promise<Buffer>;
export function isZip(buf: Buffer): boolean;

export * from "./runs.js";
export * from "./metrics.js";
export * from "./geometry.js";
import type { Run } from "./runs.js";
import type { Metrics } from "./metrics.js";

export interface RangeFont { name: string; size: number; bold: boolean; family: string }
export function readRangeFont(raw: Uint8Array): RangeFont;
export function writeRangeFont(f: RangeFont): Uint8Array;
export function boldOf(name: string): string;
export function buildRtf(templateRtf: string, runs: Run[], regular: string, bold: string): string;
export function buildRanges(runs: Run[], regular: RangeFont): { range: { start?: number; end: number }; _unknown_12: Uint8Array[] }[];
export function plainText(rtf: string): string;
export function readableText(rtf: string): string;

export interface UnknownField { type: string; field: number; wireType: number; path: string }
export function findUnknownFields(top: protobuf.Type, buf: Uint8Array): UnknownField[];
export function addPlaceholders(root: protobuf.Root, top: protobuf.Type, buf: Uint8Array): void;
export function writeUnpacked<T extends Record<string, any>>(json: T): T;

export interface Schema { root: protobuf.Root; Presentation: protobuf.Type; ThemeDocument: protobuf.Type }
export function loadSchema(): Schema;
export function decodePresentation(buf: Uint8Array): { doc: Msg; unknown: UnknownField[]; schema: Schema };
export function encodePresentation(schema: Schema, doc: Msg): Buffer;
export function checkPresentationBytes(buf: Uint8Array): { ok: boolean; unknown: UnknownField[]; stable: boolean; error?: string };

export type Role = "title" | "kicker" | "description" | "link" | "qr" | "photo" | "panel" | "highlight" | "other";
export interface RoleRules {
  panelMinWidth: number;
  qrMaxWidth: number;
  qrSquareTolerance: number;
  text: { role: Role; in: "rtf" | "font" | "rtfOrFont" | "words"; pattern: string; flags?: string }[];
  otherText: Role;
}
export const defaultRoleRules: RoleRules;
export interface Roles { roleOf(el: Msg): Role; decideRole(el: Msg): Role; rules: RoleRules }
export function createRoles(rules?: Partial<RoleRules>): Roles;

export interface MediaFile { file: string; w: number; h: number; format: string }
export function uuid(): { string: string };
export function freshCopy<T>(v: T): T;
export function rtfSize(el: Msg): number;
export function textOf(el: Msg): string;
export function setText(el: Msg, runs: Run[], size?: number): void;
export function mediaUrl(file: string, workspace: string): { absolute_string: string; platform: number; local: { root: number; path: string } };
export function setImage(el: Msg, m: MediaFile, workspace: string): void;
export const ELEMENT_NAMES: Partial<Record<Role, string>>;
export const STACK: Role[];
export function tidyElements(els: Msg[], roleOf: (el: Msg) => Role, opts?: { ownsPicture?: (fileName: string) => boolean }): Msg[];
export function fitSpeakerBox(el: Msg, words: string, maxRight?: number, metrics?: Metrics): void;
export function roleFor(name: string, table: Record<string, string>): string | undefined;
export function repointBackgrounds(cue: Msg, map: Record<string, { file: string; w: number; h: number }>, workspace: string): void;
export function tidyActions(cue: Msg, opts?: { macro?: Msg; dropClear?: boolean }): void;

export interface ElementModel {
  name: string; role: Role; kind: "text" | "image" | "shape" | "other";
  bounds: { x: number; y: number; w: number; h: number };
  text: string; fontName: string | null; fontSize: number | null; caps: boolean; media: string | null;
}
export interface SlideModel {
  uuid: string | null; label: string; enabled: boolean; text: string[]; elements: ElementModel[];
  media: { file: string | null; layer: number | null; name: string | null }[];
  macros: { name: string | null; uuid: string | null; collection: string | null; collectionUuid: string | null }[];
  actionOrder: string[];
}
export interface PresentationModel {
  uuid: string | null; name: string;
  groups: { uuid: string | null; name: string; color: string | null; slides: SlideModel[] }[];
  arrangements: { name: string; groups: string[] }[];
  slideCount: number; media: string[];
}
export interface OpenedFile { kind: "pro" | "probundle"; proName: string | null; pro: Buffer; media: { name: string; file: string; bytes: number }[] }
export function openFile(buf: Buffer, opts?: { maxEntryBytes?: number }): OpenedFile;
export function toModel(doc: Msg, opts?: { roles?: Roles }): PresentationModel;
export function mediaFilesOf(cue: Msg): string[];
export function readPresentationFile(buf: Buffer, opts?: { roles?: Roles; maxEntryBytes?: number }): { file: OpenedFile; doc: Msg; unknown: UnknownField[]; model: PresentationModel };

export interface Change { what: string; box: string | null; before: unknown; after: unknown }
export interface Diff {
  added: string[]; removed: string[]; changed: { slide: string; changes: Change[] }[];
  groups: { before: string[]; after: string[] } | null;
  arrangements: { before: string[]; after: string[] } | null;
}
export function diffModels(before: PresentationModel, after: PresentationModel): Diff;

export interface Finding { severity: "problem" | "warning" | "note"; code: string; slide: string | null; box: string | null; message: string }
export function checkFile(buf: Buffer, opts?: {
  roles?: Roles; metrics?: Metrics; knownMacros?: Set<string>; hasMedia?: (file: string) => boolean; maxEntryBytes?: number;
}): { findings: Finding[]; model: PresentationModel | null; predicted: "measured" | "rough"; file: Omit<OpenedFile, "pro"> };
