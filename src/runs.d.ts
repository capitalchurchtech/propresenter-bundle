export interface Run { text: string; bold: boolean }
export function markdownRuns(text: string): Run[];
export function linkRuns(link: string): Run[];
