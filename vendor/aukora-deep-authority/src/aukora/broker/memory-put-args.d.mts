/** A memory key is a name, never a path. */
export declare const KEY_SHAPE: RegExp

/** Test whether a value is the complete memory.put argument object. */
export declare function isExactMemoryPutArgs(
  input: unknown,
): input is { key: string; value: unknown }
