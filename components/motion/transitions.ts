import type { Transition, Variants } from "motion/react";

// Task 3.2 — the shared Framer Motion vocabulary.
//
// One home for the timings, easings, springs, and variants the app's Framer
// layer reuses, so motion stays CONSISTENT across surfaces (the hero, the
// featured grid, the ethos band, and later the cart drawer) instead of each
// component inventing its own numbers and slowly drifting apart. Consumed today
// by `Reveal` / `Stagger` / `StaggerItem`.
//
// Scope boundary: this is the FRAMER layer only. GSAP's scroll choreography
// lives entirely in `ScrollScene.tsx` and does not read from here — the two
// engines never share state or animate the same element (design.md § Animation
// Architecture). Everything here is GPU-friendly (transform/opacity) and stays
// within the craft bar: sub-600ms, ease-out / custom curves, no `scale(0)`.

// --- Easing -----------------------------------------------------------------
// Cubic-bezier control points as 4-tuples (Framer's `BezierDefinition`, a member
// of the `Easing` union — assignable without a cast).

/**
 * Expo-out — fast out of the gate, long gentle settle. The house curve for
 * elements ARRIVING on screen (entrances/reveals); `ease-out` keeps the first
 * frames responsive, which is the moment the eye is on.
 */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Strong ease-in-out for elements MOVING/morphing already on screen (not
 * entering or exiting). Natural acceleration then deceleration.
 */
export const EASE_IN_OUT: [number, number, number, number] = [0.77, 0, 0.175, 1];

// --- Durations (seconds) ----------------------------------------------------
// UI motion stays well under the craft bar's ceilings. One place to tune so the
// language never drifts.
export const DURATION_FAST = 0.2; // press feedback, small popovers
export const DURATION_BASE = 0.4; // dropdowns, standard transitions
export const DURATION_SETTLE = 0.55; // editorial entrance settle (hero/grid)

// --- Stagger cadence --------------------------------------------------------
// Short gaps — long delays make a group feel slow. Stagger is decorative; it
// never gates interaction.
export const STAGGER_STEP = 0.08; // seconds between siblings
export const STAGGER_DELAY = 0.05; // seconds before the first sibling

// --- Springs ----------------------------------------------------------------
// Apple's designer-friendly `bounce` + `duration` mapping. Default is critically
// damped (no overshoot) — correct for most UI. Reserve the momentum spring (a
// little bounce) for gesture/drag-driven surfaces where a flick preceded it.
export const SPRING_DEFAULT: Transition = {
  type: "spring",
  bounce: 0,
  duration: DURATION_BASE,
};

export const SPRING_MOMENTUM: Transition = {
  type: "spring",
  bounce: 0.2,
  duration: DURATION_BASE,
};

// --- Variants ---------------------------------------------------------------
// Reusable Framer variant sets. Movement (`y`) is dropped automatically by
// `MotionConfig reducedMotion="user"` (opacity is kept), so these degrade to a
// clean cross-fade for reduced-motion users without per-variant branching.

/** A single element fading up into place. */
export function fadeUp(y = 12): Variants {
  return {
    hidden: { opacity: 0, y },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: DURATION_SETTLE, ease: EASE_OUT },
    },
  };
}

/** Parent that orchestrates a `staggerItem` group (holds only the timeline). */
export function staggerContainer(
  step = STAGGER_STEP,
  delayChildren = STAGGER_DELAY,
): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: step, delayChildren } },
  };
}

/** Child of a `staggerContainer` — inherits the hidden/show labels. */
export function staggerItem(y = 16): Variants {
  return {
    hidden: { opacity: 0, y },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: DURATION_SETTLE, ease: EASE_OUT },
    },
  };
}
