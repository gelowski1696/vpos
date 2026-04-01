import type { DesktopRoute, DesktopRouteId } from '../../app/routes';

type Props = {
  routes: DesktopRoute[];
  activeRoute: DesktopRouteId;
  onSelect: (route: DesktopRouteId) => void;
  setupCompleted: boolean;
};

export function Sidebar({ routes, activeRoute, onSelect, setupCompleted }: Props): JSX.Element {
  return (
    <aside className="desktop-sidebar">
      <div className="brand-block">
        <div className="brand-mark">VP</div>
        <div>
          <div className="brand-title">VPOS Desktop</div>
          <div className="brand-hint">Branch cashier station</div>
        </div>
      </div>

      <div className="nav-section-label">Modules</div>
      <nav className="desktop-nav">
        {routes.map((route) => {
          const disabled = !setupCompleted && route.id !== 'settings' && route.id !== 'dashboard';
          return (
            <button
              key={route.id}
              className={`nav-item ${route.id === activeRoute ? 'nav-item-active' : ''}`}
              type="button"
              onClick={() => onSelect(route.id)}
              disabled={disabled}
            >
              <div className="nav-item-top">
                <span>{route.label}</span>
                {route.shortcut ? <kbd>{route.shortcut}</kbd> : null}
              </div>
              <div className="nav-item-copy">{route.description}</div>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
