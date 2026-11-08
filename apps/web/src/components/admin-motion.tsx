'use client';

import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import type { HTMLMotionProps } from 'framer-motion';
import { useEffect, useId, useRef, type ReactNode } from 'react';

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
        className="admin-route-page"
        data-admin-page
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
  className,
  closeOnEscape = true,
  onClose,
  ...props
}: Omit<HTMLMotionProps<'div'>, 'children'> & {
  children: ReactNode;
  closeOnEscape?: boolean;
  onClose?: () => void;
}): React.JSX.Element {
  const backdropRef = useRef<HTMLDivElement>(null);
  const generatedTitleId = `admin-dialog-title-${useId().replaceAll(':', '')}`;
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);
  onCloseRef.current = onClose;
  closeOnEscapeRef.current = closeOnEscape;

  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) {
      return undefined;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog =
      backdrop.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]') ??
      backdrop.querySelector<HTMLElement>(':scope > section, :scope > div:not(.absolute)');
    if (dialog && !dialog.hasAttribute('role')) {
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
    }
    if (
      dialog &&
      ['dialog', 'alertdialog'].includes(dialog.getAttribute('role') ?? '') &&
      !dialog.hasAttribute('aria-label') &&
      !dialog.hasAttribute('aria-labelledby')
    ) {
      const heading = dialog.querySelector<HTMLElement>('h1, h2, h3');
      if (heading) {
        if (!heading.id) {
          heading.id = generatedTitleId;
        }
        dialog.setAttribute('aria-labelledby', heading.id);
      }
    }
    const focusableSelector = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    const focusFirstControl = (): void => {
      const firstControl = dialog?.querySelector<HTMLElement>(focusableSelector);
      if (firstControl) {
        firstControl.focus();
        return;
      }

      if (dialog) {
        if (!dialog.hasAttribute('tabindex')) {
          dialog.setAttribute('tabindex', '-1');
        }
        dialog.focus();
      }
    };

    const animationFrame = window.requestAnimationFrame(focusFirstControl);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && closeOnEscapeRef.current && onCloseRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !dialog) {
        return;
      }

      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (control) => control.getClientRects().length > 0
      );
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [generatedTitleId]);

  return (
    <motion.div
      {...props}
      animate={{ opacity: 1 }}
      className={`admin-dialog-backdrop ${className ?? ''}`.trim()}
      initial={{ opacity: 0 }}
      ref={backdropRef}
      role="presentation"
    >
      {children}
    </motion.div>
  );
}
