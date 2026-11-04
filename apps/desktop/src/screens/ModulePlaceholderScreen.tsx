import type { DesktopRouteId } from '../app/routes';
import { ScreenHeader } from '../components/layout/ScreenHeader';

type Props = {
  routeId: DesktopRouteId;
  title: string;
  description: string;
  bullets: string[];
};

export function ModulePlaceholderScreen({ routeId, title, description, bullets }: Props): JSX.Element {
  return (
    <div className="space-y-5">
      <ScreenHeader routeId={routeId} title={title} description={description} />

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_20px_55px_-34px_rgba(15,23,42,0.35)]">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Coming next</div>
            <h3>We are still building this screen</h3>
          </div>
        </div>
        <ul className="bullet-list">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
