"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";

// Task 3.1 — the real motion foundation (replaces the Day-1 pass-through).
//
// Two responsibilities, kept intentionally small:
//   1. Lazy-load Framer Motion's DOM feature bundle once, at the app root, so
//      individual `m.*` components stay tree-shakeable and the animation code
//      only ships when something actually animates (LazyMotion + `domAnimation`,
//      which carries animation / variants / inView / hover / focus / tap — no
//      drag or layout weight we don't use). `strict` forbids the heavier
//      `motion.*` factory, so every animated surface must use `m.*`.
//   2. Expose ONE reduced-motion signal the whole app reads: the Framer layer
//      via `MotionConfig reducedMotion="user"` (drops transforms, keeps opacity
//      cross-fades — the accessible degrade), AND a React context so imperative
//      consumers that live outside Framer's render (the Pass-2 GSAP ScrollScene
//      especially) can branch on the same boolean instead of re-reading the
//      media query themselves.

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface MotionPreference {
  /**
   * True when the user (or their OS) asks for reduced motion. Animated
   * surfaces read this to decide between the full transition and the static
   * frame. Sourced via `useSyncExternalStore` (below) so the correct value is
   * known on the FIRST client render, not one effect-tick later — reduced-motion
   * users get the static hero immediately with no auto-playing fade (the
   * cinematic-landing reduced-motion requirement), and a mid-session Settings
   * change is picked up live.
   */
  prefersReducedMotion: boolean;
}

// External-store plumbing for the reduced-motion media query. Kept at module
// scope so the MediaQueryList is created once (lazily, client-only) and shared
// across every subscriber.
let mediaQueryList: MediaQueryList | null = null;

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  mediaQueryList ??= window.matchMedia(REDUCED_MOTION_QUERY);
  return mediaQueryList;
}

function subscribe(onChange: () => void): () => void {
  const media = getMediaQueryList();
  if (!media) return () => {};
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return getMediaQueryList()?.matches ?? false;
}

// The server can't read a media query; assume motion is allowed and let the
// client reconcile before paint if the real preference differs.
function getServerSnapshot(): boolean {
  return false;
}

const MotionPreferenceContext = createContext<MotionPreference>({
  prefersReducedMotion: false,
});

/** Full preference object. Prefer `usePrefersReducedMotion` for the boolean. */
export function useMotionPreference(): MotionPreference {
  return useContext(MotionPreferenceContext);
}

/** The one boolean most callers want: should this surface animate or not. */
export function usePrefersReducedMotion(): boolean {
  return useContext(MotionPreferenceContext).prefersReducedMotion;
}

export function MotionProvider({ children }: { children: React.ReactNode }) {
  const prefersReducedMotion = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const value = useMemo<MotionPreference>(
    () => ({ prefersReducedMotion }),
    [prefersReducedMotion],
  );

  return (
    <MotionPreferenceContext.Provider value={value}>
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </LazyMotion>
    </MotionPreferenceContext.Provider>
  );
}
