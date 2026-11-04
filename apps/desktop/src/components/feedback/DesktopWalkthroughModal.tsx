import { useMemo, useState } from 'react';
import type { DesktopRouteId } from '../../app/routes';

type Step = {
  title: string;
  description: string;
  route?: DesktopRouteId;
};

const STEPS: Step[] = [
  {
    title: 'Dashboard',
    description: 'Check branch status, pending sync, and local activity before starting counter work.',
    route: 'dashboard'
  },
  {
    title: 'Settings',
    description: 'Confirm branch data, printer path, receipt layout, and workstation defaults.',
    route: 'settings'
  },
  {
    title: 'Shift',
    description: 'Open duty before sales, petty cash, or transfers so desktop follows the same cashier flow as mobile.',
    route: 'shift'
  },
  {
    title: 'POS',
    description: 'Use the same sales order as mobile: order type, customer, personnel, items, then payment.',
    route: 'pos'
  },
  {
    title: 'Sales And Expense',
    description: 'Review sales, returns, and petty cash from the list screens after transactions are saved locally.',
    route: 'sales'
  }
];

const modalBackdropClass = 'fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4 py-8 backdrop-blur-sm';
const modalCardClass =
  'w-full max-w-2xl rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.5)]';
const stepCardClass =
  'rounded-[24px] border border-slate-200 bg-slate-50/90 px-4 py-4 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.24)]';

type Props = {
  open: boolean;
  onClose: () => void;
  onComplete: () => Promise<void> | void;
  onOpenRoute?: (route: DesktopRouteId) => void;
};

export function DesktopWalkthroughModal({ open, onClose, onComplete, onOpenRoute }: Props): JSX.Element | null {
  const [stepIndex, setStepIndex] = useState(0);

  const step = useMemo(() => STEPS[stepIndex] ?? STEPS[0], [stepIndex]);

  if (!open) {
    return null;
  }

  const handleNext = async (): Promise<void> => {
    if (stepIndex >= STEPS.length - 1) {
      await onComplete();
      setStepIndex(0);
      return;
    }
    setStepIndex((current) => current + 1);
  };

  const handleClose = (): void => {
    setStepIndex(0);
    onClose();
  };

  return (
    <div className={modalBackdropClass} onClick={handleClose}>
      <div className={modalCardClass} onClick={(event) => event.stopPropagation()}>
        <div className="pos-sheet-toolbar pos-payment-toolbar">
          <div className="panel-head pos-sheet-head">
            <div>
              <div className="eyebrow">Walkthrough</div>
              <h3>{step.title}</h3>
            </div>
            <button
              className="secondary-btn mini-btn modal-close-icon-btn"
              type="button"
              onClick={handleClose}
              aria-label="Close modal"
              title="Close"
            >
              <span aria-hidden="true">X</span>
            </button>
          </div>
        </div>

        <div className="payment-section-card pos-payment-section">
          <div className={stepCardClass}>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Step</span>
            <strong className="mt-2 block text-lg font-semibold text-slate-900">
              {stepIndex + 1} / {STEPS.length}
            </strong>
          </div>
          <p className="startup-helper-copy">{step.description}</p>
        </div>

        <div className="checkout-action-row pos-payment-actions">
          {step.route ? (
            <button
              className="secondary-btn checkout-btn checkout-btn-print-inline"
              type="button"
              onClick={() => onOpenRoute?.(step.route!)}
            >
              Open {step.title}
            </button>
          ) : null}
          <button
            className="secondary-btn checkout-btn checkout-btn-support"
            type="button"
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
            disabled={stepIndex === 0}
          >
            Back
          </button>
          <button className="primary-btn checkout-btn" type="button" onClick={() => void handleNext()}>
            {stepIndex >= STEPS.length - 1 ? 'Finish Walkthrough' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
