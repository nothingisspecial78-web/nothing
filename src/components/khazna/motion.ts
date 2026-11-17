import type { Variants } from "framer-motion";

export const REVEAL_EASE = "easeOut" as const;

/**
 * Lightweight entrance without IntersectionObserver (`whileInView`) storms.
 */
export function reveal(_i = 0, _delay = 0, opacity = 1) {
  return {
    initial: false as const,
    animate: { opacity },
    transition: { duration: 0.14, ease: REVEAL_EASE },
  };
}

const SWEEP_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const PANEL_SWAP: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.015, delayChildren: 0.01 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

export const PANEL_SWAP_ITEM: Variants = {
  hidden: { opacity: 0, x: 10 },
  show: { opacity: 1, x: 0, transition: { duration: 0.16, ease: SWEEP_EASE } },
  exit: { opacity: 0, x: -10, transition: { duration: 0.1, ease: "easeIn" } },
};
