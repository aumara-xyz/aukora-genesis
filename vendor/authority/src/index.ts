// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani

/** Portable package format. Capability exports land only behind the boundary gate. */
export const AUKORA_KERNEL_PACKAGE_VERSION = "0.1.0" as const;

export * from "./authority.js";
export * from "./canonical.js";
export * from "./errors.js";
export * from "./evidence.js";
export * from "./merkle.js";
export * from "./reducer.js";
export * from "./registry.js";
export * from "./schema.js";
export * from "./staleness.js";
