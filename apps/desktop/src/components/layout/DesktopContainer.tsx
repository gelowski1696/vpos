import type { ReactNode } from 'react';

type Width = 'standard' | 'wide' | 'full';

type Props = {
  children: ReactNode;
  width?: Width;
  className?: string;
};

const widthClass: Record<Width, string> = {
  standard: 'desktop-container--standard',
  wide: 'desktop-container--wide',
  full: 'desktop-container--full'
};

/**
 * Centers screen content with viewport-aware gutters and a max width.
 * Use width="wide" for data-dense screens (POS, sales tables);
 * width="full" disables the cap (for full-bleed canvases like dashboards).
 */
export function DesktopContainer({
  children,
  width = 'standard',
  className = ''
}: Props): JSX.Element {
  return (
    <div
      className={[
        'desktop-container',
        widthClass[width],
        className
      ]
        .filter(Boolean)
        .join(' ')}
      data-container-width={width}
    >
      {children}
    </div>
  );
}
