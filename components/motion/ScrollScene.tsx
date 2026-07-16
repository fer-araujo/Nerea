"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePrefersReducedMotion } from "./MotionProvider";

// Task 3.3 / 3.5 / 3.6 / 3.7 — the GSAP ScrollTrigger cinematic intro, confined
// to the landing and to THIS file.
//
// ARCHITECTURE / ENGINE ISOLATION (design.md § Animation Architecture):
//   GSAP is imported and used ONLY here, and it owns ONLY the scroll-driven
//   choreography of the hero it wraps. Framer Motion owns every discrete
//   component transition elsewhere (Reveal, the featured stagger, the ethos
//   band, the cart drawer later). The two engines NEVER animate the same
//   element: the hero markup passed as `children` is intentionally plain DOM
//   (no Framer wrappers), so GSAP is the sole owner of those nodes' transforms,
//   while the featured/ethos sections below stay purely Framer's.
//
// PROGRESSIVE ENHANCEMENT (the load-bearing contract):
//   The server renders the full, readable, usable static hero INSIDE this
//   wrapper. GSAP only enhances AFTER hydration, and only when it is safe to.
//   There is NO JS-hidden initial state, so there is no layout shift on load and
//   no flash-of-invisible-content — the resting frame is exactly the approved
//   static hero. Every fallback path leaves that static frame untouched:
//     • prefers-reduced-motion (3.5)  → GSAP is never imported or initialised.
//     • low-end device (3.7)          → GSAP is never imported or initialised.
//     • missing brand nodes (3.6)     → scene is not built; hero stands alone.
//     • any runtime failure           → caught; hero stands alone, no console error.
//
// The intro is scroll-SCRUBBED, not time-based: as the user scrolls the first
// ~70% of a viewport, the brand "act" (the mark + the editorial Fraunces lines)
// is pinned and recedes in sequence — a restrained fashion-show opening that
// clears the runway — then releases into the featured-pieces section that
// follows in normal document flow (whose card entrances are Framer's job).

interface ScrollSceneProps {
  children: ReactNode;
}

// --- Low-end device heuristic (task 3.7) ------------------------------------
// `deviceMemory` (GB, Chromium-only) and `connection.saveData` are not in the
// standard `Navigator` lib type; declare the shape we read.
interface LowEndNavigator extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

/**
 * Coarse, cheap, client-only signal for skipping the GSAP layer (pinning +
 * scrub is by far the most expensive thing on this page) in favour of the static
 * hero. Thresholds are deliberately conservative and the check FAILS OPEN: when
 * a signal is absent (e.g. Safari exposes neither `deviceMemory` nor Save-Data)
 * we assume a capable device and keep the cinematic layer rather than punishing
 * unknown hardware.
 *
 * Fallback fires when ANY of:
 *   - Save-Data is on            → the user explicitly asked us to do less.
 *   - deviceMemory ≤ 4 GB        → budget RAM (Chromium-only signal).
 *   - hardwareConcurrency ≤ 4    → few logical cores.
 *   - `(update: slow)` matches   → the display can't repaint quickly (e-ink / very weak).
 */
function prefersLowEndFallback(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as LowEndNavigator;

  if (nav.connection?.saveData) return true;

  if (
    typeof nav.deviceMemory === "number" &&
    nav.deviceMemory > 0 &&
    nav.deviceMemory <= 4
  ) {
    return true;
  }

  if (
    typeof nav.hardwareConcurrency === "number" &&
    nav.hardwareConcurrency > 0 &&
    nav.hardwareConcurrency <= 4
  ) {
    return true;
  }

  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(update: slow)").matches
  ) {
    return true;
  }

  return false;
}

export function ScrollScene({ children }: ScrollSceneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    // Fallback gates → leave the static hero exactly as server-rendered. GSAP
    // is not even imported on these paths, so reduced-motion and low-end users
    // never pay its download/parse cost.
    if (prefersReducedMotion) return;
    if (prefersLowEndFallback()) return;

    const root = rootRef.current;
    if (!root) return;

    let cancelled = false;
    // Only `.revert()` is needed at cleanup; gsap.Context satisfies this shape.
    let ctx: { revert: () => void } | undefined;

    // Register + build client-side only, and LAZILY: the GSAP + ScrollTrigger
    // chunk is fetched only when the cinematic path is actually taken (keeps it
    // off the critical path and out of the bundle for every fallback user).
    void (async () => {
      try {
        const [{ gsap }, { ScrollTrigger }] = await Promise.all([
          import("gsap"),
          import("gsap/ScrollTrigger"),
        ]);
        if (cancelled || !rootRef.current) return;

        gsap.registerPlugin(ScrollTrigger);
        // Mobile browser-chrome (URL bar) resize otherwise fires a refresh that
        // re-lays-out a pinned scene mid-scroll; ignoring it keeps the pin stable.
        ScrollTrigger.config({ ignoreMobileResize: true });

        ctx = gsap.context(() => {
          const q = gsap.utils.selector(root);
          const mark = q("[data-hero-mark]");
          const lede = q("[data-hero-lede]");
          const body = q("[data-hero-body]");
          const cta = q("[data-hero-cta]");

          // Graceful degradation (task 3.6): if the brand nodes aren't in the
          // DOM (e.g. the Logo failed to render), don't build the scene at all —
          // the static hero stands on its own. No throw, no broken layout.
          if (mark.length === 0 || lede.length === 0) return;

          const timeline = gsap.timeline({
            // Scroll position is the clock, so the tweens are linear; `scrub`
            // supplies the physical smoothing/inertia and makes it interruptible
            // and reversible by simply scrolling the other way.
            defaults: { ease: "none", force3D: true },
            scrollTrigger: {
              trigger: root,
              start: "top top",
              end: "+=70%",
              pin: true,
              anticipatePin: 1,
              scrub: 0.5,
            },
          });

          // The brand takes its bow: the mark settles back a touch while the
          // editorial lines lift away in sequence, clearing the runway for the
          // pieces below. GPU-only — transform via yPercent/scale, opacity via
          // autoAlpha (which also toggles visibility so faded copy isn't a
          // pointer/AT target once it's gone).
          timeline
            .to(mark, { yPercent: -8, scale: 0.96, autoAlpha: 0.35 }, 0)
            .to(lede, { yPercent: -14, autoAlpha: 0 }, 0.05)
            .to(body, { yPercent: -18, autoAlpha: 0 }, 0.1)
            .to(cta, { yPercent: -22, autoAlpha: 0 }, 0.14);
        }, root);
      } catch {
        // Any failure (chunk load, plugin registration, DOM) → keep the static
        // hero. The enhancement is strictly optional; it must never break the page.
      }
    })();

    return () => {
      cancelled = true;
      // Kills every tween/ScrollTrigger AND removes the pin-spacer + inline
      // styles created in this context — essential for React 19 / Next dev
      // double-invoke and for locale changes that remount the route. Without
      // this, a remount would stack a second pin on the same hero.
      ctx?.revert();
    };
  }, [prefersReducedMotion]);

  return <div ref={rootRef}>{children}</div>;
}
