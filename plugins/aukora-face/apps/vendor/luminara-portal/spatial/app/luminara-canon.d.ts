export const STATES: readonly string[];
export const MARKS: readonly string[];
export const LAYERS: readonly string[];
export const SUITS: readonly { key: string; gloss: string }[];

export type LuminaraCard = {
  n: number;
  name: string;
  letter: string;
  essence: string;
};

export type LuminaraPosition = {
  key: string;
  name: string;
  gloss: string;
  affinity: number;
};

export type LuminaraReading = {
  sections: Array<{
    position: LuminaraPosition;
    card: LuminaraCard;
    silent: boolean;
    body: string;
  }>;
  vectors: Array<{ line: string }>;
  harmonic: string;
  landing: string;
  summary: string;
  allSilent: boolean;
};

export const CARDS: readonly LuminaraCard[];
export const SILENCES: Record<number, { name: string; asks: string; lines: string[] }>;
export const POSITIONS: readonly LuminaraPosition[];

export type LuminaraKnot = {
  p: number;
  q: number;
  kind: 'circle' | 'coil' | 'knot' | 'link';
  components: number;
  genus: number;
  hand: 'flow' | 'turning' | 'still';
  interval: string;
};

export type LuminaraEmanation = {
  zones: Array<{ layer: string; ring: number; harmonic: number }>;
  clarity: number;
  struck: boolean;
};

export function codeOf(n: number): number[];
export function codeMarks(n: number): string;
export function knotOf(n: number): LuminaraKnot;
export function counterOf(n: number): number;
export function emanationOf(n: number): LuminaraEmanation;
export function cardOf(n: number): LuminaraCard;
export function isSilent(n: number): boolean;

/** The silence seats, derived from SILENCES, sorted and frozen. Never written by hand. */
export const SILENCE_SEATS: readonly number[];
/** How many Silences there are. Derived. Never written as a numeral anywhere else. */
export const SILENCE_COUNT: number;
export function numberWord(k: number): string;
export function ordinalWord(k: number): string;
export function listWords(ns: number[], word?: (n: any) => string): string;
/** The canonical prose teaching of the Silences, composed from the map. */
export function silenceTeaching(): string;
export function drawThree(seedStr: string): number[];
export function drawOne(seedStr: string, exclude?: number[]): number;
export function composeReading(cast: number[], intention: string | null): LuminaraReading;
export function askAumaText(reading: LuminaraReading): string;
