/** The effect's name, as it appears in an authorization claim. */
export declare const MEMORY_PUT: string

/** The effect definition to which every memory.put authorization is bound. */
export declare const MEMORY_PUT_DEFINITION: Readonly<{
  name: string
  parameters: readonly string[]
  semantics: string
  version: number
}>

/** @returns the hex digest an authorization must carry as `definitionId`. */
export declare function definitionDigest(toolName?: string): string

export declare const WORKSPACE_PATCH: 'workspace.patch'
export declare const WORKSPACE_PATCH_DEFINITION: typeof MEMORY_PUT_DEFINITION
export declare const EFFECT_DEFINITIONS: Readonly<Record<string, typeof MEMORY_PUT_DEFINITION>>
export declare function isGovernedEffect(toolName: unknown): boolean
