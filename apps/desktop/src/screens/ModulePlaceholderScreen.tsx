type Props = {
  title: string;
  description: string;
  bullets: string[];
};

export function ModulePlaceholderScreen({ title, description, bullets }: Props): JSX.Element {
  return (
    <div className="screen-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Desktop MVP</div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Planned in this module</div>
            <h3>Next implementation slice</h3>
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
