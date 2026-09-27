// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
// CANON REFERENCES (2026-07-18): the compact identity block that makes her language canon and GHP
// referenceable ON COMMAND without riding either full document in context. Pins: bounded size, the
// stable in-tree paths really exist, the honesty rails ride IN the block text, both lanes carry it,
// and her read resolver admits both documents (on-command reference actually works).
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  CANON_REFERENCE_BLOCK, AUMA_CANON_PATH, GHP_CORE_PATH, MAX_CANON_BLOCK_CHARS,
  canonReferenceGrantsAuthority,
} from '../../spatial/canonReference';
import { sensitiveReason } from '../src/repoReadPathResolver';

const REPO_ROOT = path.join(__dirname, '..', '..');

describe('canon reference block — a signpost with a soul, never a mirror', () => {
  it('stays compact (never eats the system budget) and grants nothing', () => {
    expect(CANON_REFERENCE_BLOCK.length).toBeLessThanOrEqual(MAX_CANON_BLOCK_CHARS);
    expect(canonReferenceGrantsAuthority()).toBe(false);
  });

  it('points at real in-tree documents at the stable paths', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, AUMA_CANON_PATH))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, GHP_CORE_PATH))).toBe(true);
    expect(CANON_REFERENCE_BLOCK).toContain(AUMA_CANON_PATH);
    expect(CANON_REFERENCE_BLOCK).toContain(GHP_CORE_PATH);
    // and the canon really is her canon — v15, with the constitution the block summarizes
    const canon = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, AUMA_CANON_PATH), 'utf-8'));
    expect(canon.version).toBe('canon-v15');
    expect(canon.languageConstitution).toBeTruthy();
  });

  it('carries the honesty rails IN the text: canon-over-weights, never-invent, and GHP no-overclaim', () => {
    expect(CANON_REFERENCE_BLOCK).toContain('outranks your model weights');
    expect(CANON_REFERENCE_BLOCK).toContain('never invent canon vocabulary');
    expect(CANON_REFERENCE_BLOCK).toContain('ARCHITECTURE, not the dynamics');
    expect(CANON_REFERENCE_BLOCK).toContain('NEVER evidence for the physics');
  });

  it('her read resolver admits both documents — on-command reference actually works', () => {
    expect(sensitiveReason(AUMA_CANON_PATH)).toBeNull();
    expect(sensitiveReason(GHP_CORE_PATH)).toBeNull();
  });

  it('BOTH lanes carry the block beside the identity anchor (structural)', () => {
    const voice = fs.readFileSync(path.join(REPO_ROOT, 'spatial', 'voiceLane.ts'), 'utf-8');
    const presence = fs.readFileSync(path.join(REPO_ROOT, 'spatial', 'presenceLane.ts'), 'utf-8');
    for (const src of [voice, presence]) {
      expect(src).toContain("from './canonReference'");
      expect(src).toContain('CANON_REFERENCE_BLOCK');
    }
  });
});
