// Types for the shared [field …] grammar module (see field-directives.js).
export const FIELD_HUES: Record<string, number>;
export const FIELD_FORMS: Record<string, number>;
export function makeDirectiveFilter(apply: (tag: string) => void): {
  push(chunk: string): string;
  flush(): string;
};
