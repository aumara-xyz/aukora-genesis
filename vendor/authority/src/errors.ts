// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

export class KernelInputError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "KernelInputError";
    this.code = code;
  }
}

export function refuseInput(code: string): never {
  throw new KernelInputError(code);
}
