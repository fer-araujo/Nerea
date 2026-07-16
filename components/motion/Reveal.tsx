"use client";

import type { ReactNode } from "react";
import { m } from "motion/react";
import { usePrefersReducedMotion } from "./MotionProvider";

// Tasteful, restrained Framer micro-interactions for the static landing: a
// quiet entrance settle on the hero and a staggered reveal for the featured
// grid. Deliberately small in scope (opacity + a few px of travel, sub-600ms,
// GPU-only transform/opacity). Nothing here is required to READ the page: when
// the user prefers reduced motion these render the resting frame directly (no
// hidden initial, so no flash-of-invisible-content and no reliance on JS to
// reveal anything). Hover states are handled in CSS via Tailwind's `hover:`
// variant, which is already wrapped in `@media (hover: hover)`.

// Expo-out — matches the craft bar's ease [0.16, 1, 0.3, 1]. Typed as a
// 4-tuple so it satisfies Framer's `Easing` without a cast.
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const DURATION = 0.55;

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Vertical travel in px for the settle. */
  y?: number;
  /** Seconds to wait before starting. */
  delay?: number;
  /**
   * `mount` animates immediately (use above the fold, e.g. the hero); `in-view`
   * waits until the element scrolls into view (use below the fold).
   */
  mode?: "mount" | "in-view";
}

export function Reveal({
  children,
  className,
  y = 12,
  delay = 0,
  mode = "in-view",
}: RevealProps) {
  const reduce = usePrefersReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  const transition = { duration: DURATION, delay, ease: EASE };
  const hidden = { opacity: 0, y };
  const shown = { opacity: 1, y: 0 };

  if (mode === "mount") {
    return (
      <m.div
        className={className}
        initial={hidden}
        animate={shown}
        transition={transition}
      >
        {children}
      </m.div>
    );
  }

  return (
    <m.div
      className={className}
      initial={hidden}
      whileInView={shown}
      viewport={{ once: true, amount: 0.2 }}
      transition={transition}
    >
      {children}
    </m.div>
  );
}

interface StaggerProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "ul";
  /** `mount` orchestrates on load (hero); `in-view` waits for scroll (grids). */
  trigger?: "mount" | "in-view";
  /** Seconds between each child. */
  stagger?: number;
  /** Seconds before the first child starts. */
  delayChildren?: number;
}

// Orchestrates a set of `StaggerItem` children. The parent holds the timeline
// (staggerChildren); each item declares only its own hidden/shown states and
// inherits the "hidden"/"show" labels through Framer's variant propagation.
export function Stagger({
  children,
  className,
  as = "div",
  trigger = "in-view",
  stagger = 0.08,
  delayChildren = 0.05,
}: StaggerProps) {
  const reduce = usePrefersReducedMotion();

  if (reduce) {
    return as === "ul" ? (
      <ul className={className}>{children}</ul>
    ) : (
      <div className={className}>{children}</div>
    );
  }

  const variants = {
    hidden: {},
    show: { transition: { staggerChildren: stagger, delayChildren } },
  };

  const shared = {
    className,
    variants,
    initial: "hidden",
    ...(trigger === "mount"
      ? { animate: "show" }
      : {
          whileInView: "show",
          viewport: { once: true, amount: 0.2 },
        }),
  } as const;

  return as === "ul" ? (
    <m.ul {...shared}>{children}</m.ul>
  ) : (
    <m.div {...shared}>{children}</m.div>
  );
}

interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "li";
  y?: number;
}

export function StaggerItem({
  children,
  className,
  as = "div",
  y = 16,
}: StaggerItemProps) {
  const reduce = usePrefersReducedMotion();

  if (reduce) {
    return as === "li" ? (
      <li className={className}>{children}</li>
    ) : (
      <div className={className}>{children}</div>
    );
  }

  const variants = {
    hidden: { opacity: 0, y },
    show: { opacity: 1, y: 0, transition: { duration: DURATION, ease: EASE } },
  };

  return as === "li" ? (
    <m.li className={className} variants={variants}>
      {children}
    </m.li>
  ) : (
    <m.div className={className} variants={variants}>
      {children}
    </m.div>
  );
}
