type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
};

export function SearchField({
  value,
  onChange,
  placeholder,
  autoFocus = false,
  className = ''
}: Props): JSX.Element {
  const inputClassName = ['desktop-search', 'search-field-input', className].filter(Boolean).join(' ');

  return (
    <div className="search-field-wrap">
      <span className="search-field-icon" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="9" r="5.5" />
          <path d="M13.5 13.5L17 17" />
        </svg>
      </span>
      <input
        type="search"
        className={inputClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
      />
      {value ? (
        <button
          type="button"
          className="search-field-clear"
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          X
        </button>
      ) : null}
    </div>
  );
}
