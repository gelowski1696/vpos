import logoSrc from '../../assets/vpos-logo.png';

type Props = {
  title: string;
  subtitle?: string;
  compact?: boolean;
};

export function BrandLogo({ title, subtitle, compact = false }: Props): JSX.Element {
  return (
    <div className={`brand-block ${compact ? 'brand-block-compact' : ''}`}>
      <div className="brand-mark brand-mark-logo">
        <img src={logoSrc} alt="VPOS" />
      </div>
      <div>
        <div className="brand-title">{title}</div>
        {subtitle ? <div className="brand-hint">{subtitle}</div> : null}
      </div>
    </div>
  );
}
