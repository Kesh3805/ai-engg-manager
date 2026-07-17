import { Variants } from 'framer-motion';

export const PANEL_ENTER: Variants = {
  initial: { opacity: 0, y: 16, scale: 0.97, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -8, scale: 0.98, filter: 'blur(2px)', transition: { duration: 0.2, ease: [0.36, 0, 1, 1] } },
};

export const PANEL_SLIDE_RIGHT: Variants = {
  initial: { opacity: 0, x: 40, filter: 'blur(6px)' },
  animate: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, x: 24, filter: 'blur(3px)', transition: { duration: 0.25, ease: [0.36, 0, 1, 1] } },
};

export const STAGGER_CONTAINER: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
};

export const STAGGER_ITEM: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

export const GLASS_HOVER = {
  whileHover: { scale: 1.02, transition: { duration: 0.15, ease: [0.34, 1.56, 0.64, 1] } },
  whileTap:   { scale: 0.98 },
};
