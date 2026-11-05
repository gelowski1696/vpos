'use client';

import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import type { ReactNode } from 'react';

export function AdminMotionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </MotionConfig>
  );
}

export function AdminPageTransition({
  children,
  routeKey
}: {
  children: ReactNode;
  routeKey: string;
}): React.JSX.Element {
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        initial={{ opacity: 0, y: 6 }}
        key={routeKey}
        transition={{ duration: 0.14 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export function AdminModalMotion({
  children,
  className
}: {
  children: ReactNode;
  className: string;
}): React.JSX.Element {
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className={className}
      initial={{ opacity: 0 }}
      role="presentation"
    >
      {children}
    </motion.div>
  );
}
