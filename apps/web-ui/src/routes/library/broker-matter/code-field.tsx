/**
 * The pairing code, typed into one large field that shows its format: the digits in their groups
 * - 0000 – 000 – 0000 for eleven, two groups of five more for twenty-one - those typed bright, the
 * rest faint, the caret where the next one goes. A **Paste** button inside takes the code from the
 * clipboard, or the QR code's text (`MT:…`), which is shown as it is.
 *
 * The field is a real input laid over the drawing, so typing, pasting, selecting and a screen
 * reader all work as on any field; what is drawn is only what it holds, grouped.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { AppIcon, cn } from '@nebulahome/ui';

/** The groups of an eleven-digit code, then those a twenty-one-digit one adds. */
const SHORT_GROUPS = [4, 3, 4] as const;
const LONG_GROUPS = [4, 3, 4, 5, 5] as const;

/**
 * What a code is, as typed: the digits of a manual code, or the text of a QR code.
 *
 * @param raw - What was typed or pasted.
 * @returns The code to keep.
 */
export function cleanCode(raw: string): string {
  const trimmed = raw.trim();

  if (/^mt:/iu.test(trimmed)) {
    return `MT:${trimmed.slice(3).toUpperCase().replaceAll(/\s/gu, '')}`;
  }

  return trimmed.replaceAll(/\D/gu, '').slice(0, 21);
}

/**
 * Whether a code is whole: eleven or twenty-one digits, or a QR code's text.
 *
 * @param code - The code, cleaned.
 * @returns True when it can be sent.
 */
export function isWholeCode(code: string): boolean {
  return /^(?:\d{11}|\d{21}|MT:[0-9A-Z.-]{19,})$/u.test(code);
}

/** What the field needs. */
export type PairingCodeFieldProps = {
  readonly value: string;
  readonly onChange: (code: string) => void;

  /** Called on Enter with a whole code. */
  readonly onSubmit: () => void;
};

/**
 * Renders the field.
 *
 * @param props - See {@link PairingCodeFieldProps}.
 * @returns The field with its label and hint.
 */
export function PairingCodeField(props: PairingCodeFieldProps) {
  const { t } = useTranslation();
  const { value, onChange, onSubmit } = props;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(true);

  // The dialog is the code: typing it is what it is opened for. A frame later, because the
  // dialog moves focus to its first button as it opens, after this field has mounted.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);
  const isQr = value.startsWith('MT:');
  const groups = value.length > 11 ? LONG_GROUPS : SHORT_GROUPS;
  let at = 0;

  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor={id} className="text-ui-sm font-medium text-foreground-muted">
        {t('brokers.matter.add.code', 'Pairing code')}
      </label>
      <div
        className={cn(
          'relative flex h-17 items-center gap-3 rounded-card border bg-canvas/55 pr-3.5 pl-5 transition-shadow',
          isFocused ? 'border-primary ring-4 ring-primary/16' : 'border-border-strong',
        )}
      >
        <span
          aria-hidden="true"
          className="min-w-0 grow truncate font-mono text-display tracking-wider whitespace-nowrap"
        >
          {isQr ? (
            <span className="text-foreground">{value}</span>
          ) : (
            groups.map((size, index) => {
              const start = at;

              at += size;

              return (
                <span key={`group-${String(index)}`}>
                  {index === 0 ? null : <span className="px-2 text-foreground-subtle">–</span>}
                  {[...Array.from({ length: size }).keys()].map((offset) => {
                    const position = start + offset;
                    const digit = value[position];

                    return (
                      <span key={`digit-${String(position)}`}>
                        {position === value.length && isFocused ? (
                          <span className="mx-px inline-block h-7.5 w-0.5 bg-primary align-middle motion-safe:animate-pulse" />
                        ) : null}
                        {digit === undefined ? (
                          <span className="text-foreground-subtle opacity-55">0</span>
                        ) : (
                          <span className="text-foreground">{digit}</span>
                        )}
                      </span>
                    );
                  })}
                </span>
              );
            })
          )}
        </span>
        <input
          ref={input}
          id={id}
          value={value}
          inputMode={isQr ? 'text' : 'numeric'}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${id}-hint`}
          className="absolute inset-0 rounded-card bg-transparent text-transparent caret-transparent outline-none selection:bg-primary/20"
          onFocus={() => {
            setIsFocused(true);
          }}
          onBlur={() => {
            setIsFocused(false);
          }}
          onChange={(event) => {
            onChange(cleanCode(event.target.value));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && isWholeCode(value)) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <button
          type="button"
          className="relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill border border-border-strong bg-surface-raised px-3 text-ui-sm text-foreground transition-colors hover:bg-surface-high focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none"
          onClick={() => {
            void navigator.clipboard
              .readText()
              .then((text) => {
                onChange(cleanCode(text));
                input.current?.focus();
              })
              .catch(() => {
                // A clipboard the browser keeps to itself leaves the field as it was.
                input.current?.focus();
              });
          }}
        >
          <AppIcon id="clipboard-paste" size={15} className="text-foreground-muted" />
          {t('brokers.matter.add.paste', 'Paste')}
        </button>
      </div>
      <span id={`${id}-hint`} className="text-caption text-foreground-subtle">
        <Trans
          i18nKey="brokers.matter.add.hint"
          defaults="11 or 21 digits. The QR code’s text (<0>MT:…</0>) can be pasted too."
          components={[<span key="qr" className="font-mono" />]}
        />
      </span>
    </div>
  );
}
