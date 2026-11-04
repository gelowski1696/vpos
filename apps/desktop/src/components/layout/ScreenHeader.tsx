import { DESKTOP_ROUTES, type DesktopRouteId } from '../../app/routes';

type HeaderVariant = 'workspace' | 'module';

type Props = {
  routeId: DesktopRouteId;
  title: string;
  description: string;
  actions?: React.ReactNode;
  variant?: HeaderVariant;
};

const WORKSPACE_ROUTES = new Set<DesktopRouteId>(['pos', 'sales', 'transfer', 'transfer-list']);

function resolveVariant(routeId: DesktopRouteId, variant?: HeaderVariant): HeaderVariant {
  if (variant) {
    return variant;
  }
  return WORKSPACE_ROUTES.has(routeId) ? 'workspace' : 'module';
}

export function ScreenHeader({ routeId, title, description, actions, variant }: Props): JSX.Element {
  const route = DESKTOP_ROUTES.find((entry) => entry.id === routeId);
  const resolvedVariant = resolveVariant(routeId, variant);

  return (
    <section className={`screen-header screen-header--${resolvedVariant}`}>
      <div className="screen-header-main">
        <div className="screen-header-copy">
          <div className="screen-header-kicker">{route?.label ?? 'VPOS'}</div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {actions ? <div className={`screen-header-actions screen-header-actions--${resolvedVariant}`}>{actions}</div> : null}
    </section>
  );
}
