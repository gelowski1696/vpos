import { useEffect, useMemo, useRef, useState } from 'react';

type Props = {
  value: string;
  onChange: (next: string) => void;
  editable?: boolean;
  autoFocus?: boolean;
  length?: number;
};

function sanitizePin(value: string, length: number): string {
  return value.replace(/\D/g, '').slice(0, length);
}

export function DesktopPinCodeInput({
  value,
  onChange,
  editable = true,
  autoFocus = false,
  length = 4
}: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const pin = useMemo(() => sanitizePin(value, length), [length, value]);

  const focusInput = (): void => {
    if (!editable) {
      return;
    }
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (!autoFocus || !editable) {
      return;
    }
    const handles = [40, 160].map((delay) =>
      window.setTimeout(() => {
        focusInput();
      }, delay)
    );
    return () => {
      handles.forEach((handle) => window.clearTimeout(handle));
    };
  }, [autoFocus, editable]);

  return (
    <button type="button" className="desktop-pin-wrap" onClick={focusInput} disabled={!editable}>
      <input
        ref={inputRef}
        value={pin}
        onChange={(event) => onChange(sanitizePin(event.target.value, length))}
        className="desktop-pin-hidden-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        disabled={!editable}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <div className="desktop-pin-row">
        {Array.from({ length }, (_, index) => {
          const isFilled = index < pin.length;
          const isActive = focused && (index === pin.length || (pin.length === length && index === length - 1));
          return (
            <div
              key={`desktop-pin-box-${index}`}
              className={`desktop-pin-box ${isFilled ? 'filled' : ''} ${isActive ? 'active' : ''}`}
            >
              <span>{isFilled ? '\u2022' : ''}</span>
            </div>
          );
        })}
      </div>
    </button>
  );
}
