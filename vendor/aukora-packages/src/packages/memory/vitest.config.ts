// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,js}"],
    testTimeout: 30_000,
  },
});
