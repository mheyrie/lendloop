"use client";
// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.

import { MotionConfig, motion, type HTMLMotionProps, type Transition, type Variants } from "motion/react";
import type { ReactNode } from "react";

/** One spring for the whole app so movement feels consistent. */
export const spring: Transition = { type: "spring", stiffness: 380, damping: 32, mass: 0.8 };
const ease: Transition = { duration: 0.45, ease: [0.22, 1, 0.36, 1] };

/** Honors the OS "reduce motion" setting everywhere below it. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={spring}>
      {children}
    </MotionConfig>
  );
}

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: ease },
};

export const stagger = (gap = 0.06, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

/** Container that staggers its <MotionItem> children in on mount (or when scrolled into view). */
export function Stagger({
  children,
  gap,
  delay,
  inView = false,
  ...rest
}: { children: ReactNode; gap?: number; delay?: number; inView?: boolean } & HTMLMotionProps<"div">) {
  const trigger = inView ? { whileInView: "show", viewport: { once: true, margin: "-60px" } } : { animate: "show" };
  return (
    <motion.div variants={stagger(gap, delay)} initial="hidden" {...trigger} {...rest}>
      {children}
    </motion.div>
  );
}

export function MotionItem({ children, ...rest }: { children: ReactNode } & HTMLMotionProps<"div">) {
  return (
    <motion.div variants={fadeUp} {...rest}>
      {children}
    </motion.div>
  );
}

/** Props for list rows that animate in, out and when siblings move. */
export const rowMotion = {
  layout: true,
  initial: { opacity: 0, y: 10, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.18 } },
} as const;
