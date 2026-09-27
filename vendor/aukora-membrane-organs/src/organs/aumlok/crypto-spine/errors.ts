// LOCAL STUB (AUMLOK-SPINE-UNBLOCK-v0) — NOT @aukora/kernel parity. See LIMITS.md.

/** Content-bearing code only — no secret material. Used by schema.ts assert* gates. */
export class KernelInputError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "KernelInputError";
    this.code = code;
  }
}
