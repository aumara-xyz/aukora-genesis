// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
export class KernelInputError extends Error {
    code;
    constructor(code) {
        super(code);
        this.name = "KernelInputError";
        this.code = code;
    }
}
export function refuseInput(code) {
    throw new KernelInputError(code);
}
