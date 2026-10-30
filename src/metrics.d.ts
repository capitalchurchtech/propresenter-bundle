export type Face = "body" | "head" | "bold";
export interface Metrics { widthOf(text: string, size: number, face?: Face): number; measured: boolean }
export function tableMetrics(tables: Partial<Record<Face, { d: number; w: Record<string, number> }>>): Metrics;
export const fallbackMetrics: Metrics;
