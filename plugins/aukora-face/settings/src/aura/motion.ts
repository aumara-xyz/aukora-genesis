// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/** Pure presentation motion and real-activity breath envelopes for Aura. */

import { REST, TAU, type Triad } from './figure.ts'
import { FIGURE_ORIENTATION } from './rotor.ts'

/** Duration of one complete visible rotation around Aura's primary spatial plane. */
export const AURA_ROTATION_PERIOD_MS = 72_000

/** Maximum fractional scale displacement created by the idle presence carrier. */
export const AURA_REST_SCALE_LIMIT = 0.008

/** Maximum additional scale displacement created by recent logged activity. */
export const AURA_ACTIVITY_SCALE_LIMIT = 0.046

/** Fraction by which the transient activity drive relaxes on each coefficient frame. */
export const AURA_BREATH_DRIVE_DECAY = 0.04

/** Fraction by which visible breath follows its transient drive on each coefficient frame. */
export const AURA_BREATH_RESPONSE = 0.16

/** Absolute coefficient distance that snaps a relaxing value to its exact target. */
export const AURA_MOTION_EPSILON = 0.002

/** Presentation-only viewing values for one active elapsed time. */
export interface AuraPresentationFrame {
  /** Activity strength derived only from current transient coefficients. */
  activity: number
  /** Shared orientation applied to both the current and reference tesseracts. */
  orientation: readonly [number, number, number, number, number, number]
  /** Shared display scale comprising idle presence and real-activity breath. */
  scale: number
}

/** Two-stage activity state that gives each real impulse an attack and release. */
export interface AuraBreathMotion {
  /** Relaxing target excited by new durable activity. */
  drive: Triad
  /** Visible transient coefficients carried into the Walsh field. */
  value: Triad
}

function finiteTime(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/**
 * Whether two exact triads describe the same rendered coefficient state.
 * @param left - first coefficient triad.
 * @param right - second coefficient triad.
 * @returns whether all three coefficients are exactly equal.
 */
export function sameAuraTriad(left: Triad, right: Triad): boolean {
  return left.every((value, index) => value === right[index])
}

/**
 * Move one triad toward a target and snap close values to the exact target.
 * @param previous - currently rendered coefficients.
 * @param target - coefficient target.
 * @param rate - fraction of remaining distance applied by this step.
 * @returns the next bounded transition step.
 */
export function approachAuraTriad(previous: Triad, target: Triad, rate = 0.18): Triad {
  const resolvedRate = Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : 0.18
  const approach = (value: number, targetValue: number) => {
    const next = value + (targetValue - value) * resolvedRate
    return Math.abs(targetValue - next) <= AURA_MOTION_EPSILON ? targetValue : next
  }
  return [
    approach(previous[0], target[0]),
    approach(previous[1], target[1]),
    approach(previous[2], target[2]),
  ]
}

/**
 * Add real logged activity to the breath drive without exceeding one per plane.
 * @param motion - current two-stage breath state.
 * @param impulse - human, assistant, and tool activity deltas.
 * @returns excited breath state; the visible value is unchanged until its attack step.
 */
export function exciteAuraBreath(motion: AuraBreathMotion, impulse: Triad): AuraBreathMotion {
  return {
    drive: [
      Math.min(1, motion.drive[0] + Math.max(0, impulse[0])),
      Math.min(1, motion.drive[1] + Math.max(0, impulse[1])),
      Math.min(1, motion.drive[2] + Math.max(0, impulse[2])),
    ],
    value: [...motion.value],
  }
}

/**
 * Advance one organic attack-and-release step for the transient Aura coefficients.
 * @param motion - current drive and visible breath values.
 * @returns the next state, eventually snapping both triads to exact rest.
 */
export function stepAuraBreath(motion: AuraBreathMotion): AuraBreathMotion {
  const drive = approachAuraTriad(motion.drive, [...REST], AURA_BREATH_DRIVE_DECAY)
  return {
    drive,
    value: approachAuraTriad(motion.value, drive, AURA_BREATH_RESPONSE),
  }
}

/**
 * Whether both stages of the transient breath have returned to exact rest.
 * @param motion - current drive and visible breath values.
 * @returns whether the drive and visible values are all exactly zero.
 */
export function auraBreathAtRest(motion: AuraBreathMotion): boolean {
  return sameAuraTriad(motion.drive, [...REST]) && sameAuraTriad(motion.value, [...REST])
}

/**
 * Reduce three transient coefficients to a bounded presentation strength.
 * @param breath - current human, assistant, and tool breath coefficients.
 * @returns root-mean-square activity in `[0, 1]`.
 */
export function auraActivityEnergy(breath: Triad): number {
  return bounded(Math.hypot(...breath) / Math.sqrt(3), 0, 1)
}

/**
 * Compute the shared slow viewing rotation.
 * @param elapsedMs - active, visible presentation time.
 * @returns six-plane viewing orientation; fourth-axis planes remain fixed.
 */
export function auraOrientationAt(
  elapsedMs: number,
): readonly [number, number, number, number, number, number] {
  const phase = TAU * (finiteTime(elapsedMs) % AURA_ROTATION_PERIOD_MS) / AURA_ROTATION_PERIOD_MS
  return [
    (FIGURE_ORIENTATION[0] ?? 0) + 0.09 * Math.sin(phase),
    (FIGURE_ORIENTATION[1] ?? 0) + 0.12 * Math.sin(phase * 2 + 0.8),
    (FIGURE_ORIENTATION[2] ?? 0) + phase,
    FIGURE_ORIENTATION[3] ?? 0,
    FIGURE_ORIENTATION[4] ?? 0,
    FIGURE_ORIENTATION[5] ?? 0,
  ]
}

/**
 * Compute a zero-mean, presentation-only idle presence carrier.
 * @param elapsedMs - active, visible presentation time.
 * @returns shared display scale within `1 ± AURA_REST_SCALE_LIMIT`.
 */
export function auraRestScaleAt(elapsedMs: number): number {
  const time = finiteTime(elapsedMs)
  return 1
    + 0.006 * Math.sin(TAU * time / 6_800)
    + 0.002 * Math.sin(TAU * time / 4_100)
}

/**
 * Compose the presentation frame without changing data coefficients or their digest.
 * @param elapsedMs - active, visible presentation time.
 * @param breath - real-activity transient coefficients.
 * @param reducedMotion - whether all continuous presentation motion is disabled.
 * @returns shared view orientation, scale, and attributable activity strength.
 */
export function auraPresentationAt(
  elapsedMs: number,
  breath: Triad,
  reducedMotion = false,
): AuraPresentationFrame {
  const activity = auraActivityEnergy(breath)
  if (reducedMotion) {
    return {
      activity,
      orientation: [
        FIGURE_ORIENTATION[0] ?? 0,
        FIGURE_ORIENTATION[1] ?? 0,
        FIGURE_ORIENTATION[2] ?? 0,
        FIGURE_ORIENTATION[3] ?? 0,
        FIGURE_ORIENTATION[4] ?? 0,
        FIGURE_ORIENTATION[5] ?? 0,
      ],
      scale: 1,
    }
  }

  const activityWave = 0.036 + 0.01 * Math.sin(TAU * finiteTime(elapsedMs) / 1_240)
  return {
    activity,
    orientation: auraOrientationAt(elapsedMs),
    scale: auraRestScaleAt(elapsedMs) + activity * activityWave,
  }
}
