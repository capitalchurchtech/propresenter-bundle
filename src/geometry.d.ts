import type { Run } from "./runs.js";
import type { Metrics, Face } from "./metrics.js";

export interface BreakRules { weakEnd: Set<string>; month: RegExp; dayPart: RegExp; numbered: RegExp }
export const englishBreaks: BreakRules;
export function linePitch(size: number, multiple?: number): number;
export const BOX_PAD: number;
export const LINE_PADDING: number;
export interface WrappedWord { text: string; w: number; space: number; parts: { text: string; bold: boolean; x: number; w: number }[]; breakAfter?: boolean }
export interface Geometry {
  metrics: Metrics;
  textWidth(text: string, size: number, face?: Face): number;
  wrapRuns(runs: Run[], size: number, width: number, regular?: "body" | "head"): WrappedWord[][];
  withoutOrphan(markdown: string, size: number, boxWidth: number, regular?: "body" | "head"): string;
  boldBoxes(runs: Run[], size: number, width: number, pitch: number, height: number): { x: number; y: number; w: number; h: number }[];
  titleLines(text: string, size: number, boxWidth: number): number;
}
export function createGeometry(opts?: { metrics?: Metrics; breaks?: BreakRules }): Geometry;
