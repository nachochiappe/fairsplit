'use client';

import { evaluateBasicCalculation, MAX_MONEY_AMOUNT } from '@fairsplit/shared';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Translation } from '../../lib/i18n';

type CalculatorCopy = Translation['expenses']['form']['calculator'];

interface AmountCalculatorProps {
  copy: CalculatorCopy;
  onApply: (value: number) => void;
  value: number | undefined;
}

const operatorClass =
  'bg-blue-50 font-semibold text-brand-700 hover:bg-blue-100 focus-visible:ring-brand-600';
const numberClass =
  'bg-white font-medium text-slate-800 hover:bg-slate-50 focus-visible:ring-brand-600';

export type CalculatorKeyboardAction =
  | { type: 'append-number'; value: string }
  | { type: 'append-operator'; value: string }
  | { type: 'backspace' | 'calculate' | 'clear' };

export function getCalculatorKeyboardAction(
  key: string,
  code: string,
  hasShortcutModifier: boolean,
): CalculatorKeyboardAction | null {
  if (hasShortcutModifier) {
    return null;
  }

  if (/^Numpad\d$/.test(code)) {
    return { type: 'append-number', value: code.slice(-1) };
  }

  const numpadActions: Record<string, CalculatorKeyboardAction> = {
    NumpadAdd: { type: 'append-operator', value: '+' },
    NumpadComma: { type: 'append-number', value: '.' },
    NumpadDecimal: { type: 'append-number', value: '.' },
    NumpadDivide: { type: 'append-operator', value: '÷' },
    NumpadEnter: { type: 'calculate' },
    NumpadEqual: { type: 'calculate' },
    NumpadMultiply: { type: 'append-operator', value: '×' },
    NumpadSubtract: { type: 'append-operator', value: '-' },
  };
  if (numpadActions[code]) {
    return numpadActions[code];
  }

  if (/^\d$/.test(key)) {
    return { type: 'append-number', value: key };
  }
  if (key === '.' || key === ',') {
    return { type: 'append-number', value: '.' };
  }
  if (key === '+' || key === '-') {
    return { type: 'append-operator', value: key };
  }
  if (key === '*' || key.toLocaleLowerCase() === 'x') {
    return { type: 'append-operator', value: '×' };
  }
  if (key === '/') {
    return { type: 'append-operator', value: '÷' };
  }
  if (key === 'Enter' || key === '=') {
    return { type: 'calculate' };
  }
  if (key === 'Backspace') {
    return { type: 'backspace' };
  }
  if (key.toLocaleLowerCase() === 'c') {
    return { type: 'clear' };
  }

  return null;
}

function CalculatorIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" className="h-[18px] w-[18px]">
      <rect x="4" y="3" width="16" height="18" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7.5 7.5h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BackspaceIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" className="h-[18px] w-[18px]">
      <path
        d="m10 7-5 5 5 5h8.25A1.75 1.75 0 0 0 20 15.25v-6.5A1.75 1.75 0 0 0 18.25 7H10Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="m13 10 4 4m0-4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function AmountCalculator({ copy, onApply, value }: AmountCalculatorProps) {
  const dialogId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [expression, setExpression] = useState('0');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogPosition, setDialogPosition] = useState({ left: 16, top: 0, width: 288 });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const updateDialogPosition = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) {
        return;
      }

      const viewportPadding = 16;
      const width = Math.min(288, window.innerWidth - viewportPadding * 2);
      const left = Math.min(
        Math.max(viewportPadding, trigger.right - width),
        window.innerWidth - width - viewportPadding,
      );
      const dialogHeight = dialogRef.current?.offsetHeight ?? 400;
      const belowTop = trigger.bottom + 8;
      const aboveTop = trigger.top - dialogHeight - 8;
      const top =
        belowTop + dialogHeight <= window.innerHeight - viewportPadding ||
        aboveTop < viewportPadding
          ? belowTop
          : aboveTop;
      setDialogPosition({ left, top, width });
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target) &&
        !dialogRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };

    updateDialogPosition();
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updateDialogPosition);
    window.addEventListener('scroll', updateDialogPosition, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updateDialogPosition);
      window.removeEventListener('scroll', updateDialogPosition, true);
    };
  }, [isOpen]);

  const openCalculator = () => {
    setExpression(value === undefined ? '0' : String(value));
    setResult(value === undefined ? null : String(value));
    setError(null);
    setIsOpen(true);
  };

  const appendNumber = useCallback(
    (next: string) => {
      setExpression((current) => {
        const base = result !== null ? '' : current;
        if (next === '.') {
          const currentNumber = base.split(/[+\-×÷]/).at(-1) ?? '';
          if (currentNumber.includes('.')) {
            return current;
          }
          return base === '' || /[+\-×÷]$/.test(base) ? `${base}0.` : `${base}.`;
        }
        if (base === '0') {
          return next;
        }
        return `${base}${next}`;
      });
      setResult(null);
      setError(null);
    },
    [result],
  );

  const appendOperator = useCallback((operator: string) => {
    setExpression((current) => {
      if (/[+\-×÷]$/.test(current)) {
        return `${current.slice(0, -1)}${operator}`;
      }
      return `${current}${operator}`;
    });
    setResult(null);
    setError(null);
  }, []);

  const clearCalculation = useCallback(() => {
    setExpression('0');
    setResult(null);
    setError(null);
  }, []);

  const backspace = useCallback(() => {
    setExpression((current) => (current.length <= 1 ? '0' : current.slice(0, -1)));
    setResult(null);
    setError(null);
  }, []);

  const calculate = useCallback(() => {
    const calculation = evaluateBasicCalculation(expression);
    if (!calculation.ok) {
      setResult(null);
      setError(
        calculation.reason === 'division-by-zero' ? copy.divisionByZero : copy.invalidExpression,
      );
      return null;
    }

    const numericResult = Number(calculation.value);
    if (numericResult < 0 || numericResult > MAX_MONEY_AMOUNT) {
      setResult(null);
      setError(copy.outOfRange);
      return null;
    }

    setExpression(calculation.value);
    setResult(calculation.value);
    setError(null);
    return numericResult;
  }, [copy.divisionByZero, copy.invalidExpression, copy.outOfRange, expression]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleCalculatorKeyDown = (event: KeyboardEvent) => {
      const action = getCalculatorKeyboardAction(
        event.key,
        event.code,
        event.altKey || event.ctrlKey || event.metaKey,
      );
      if (!action) {
        return;
      }

      event.preventDefault();
      if (action.type === 'append-number') {
        appendNumber(action.value);
      } else if (action.type === 'append-operator') {
        appendOperator(action.value);
      } else if (action.type === 'backspace') {
        backspace();
      } else if (action.type === 'clear') {
        clearCalculation();
      } else {
        calculate();
      }
    };

    document.addEventListener('keydown', handleCalculatorKeyDown);
    return () => document.removeEventListener('keydown', handleCalculatorKeyDown);
  }, [appendNumber, appendOperator, backspace, calculate, clearCalculation, isOpen]);

  const useResult = () => {
    const numericResult = result === null ? calculate() : Number(result);
    if (numericResult === null) {
      return;
    }
    onApply(numericResult);
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const keyClass =
    'flex min-h-11 items-center justify-center rounded-lg text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1';

  return (
    <div className="absolute inset-y-0 right-0 z-20" ref={rootRef}>
      <button
        ref={triggerRef}
        aria-controls={isOpen ? dialogId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={copy.open}
        className="flex h-full min-h-11 w-11 items-center justify-center rounded-r-xl border-y border-r border-transparent text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-brand-700 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-inset"
        onClick={() => (isOpen ? setIsOpen(false) : openCalculator())}
        type="button"
      >
        <CalculatorIcon />
      </button>

      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              aria-label={copy.title}
              className="fixed z-[100] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl"
              id={dialogId}
              ref={dialogRef}
              role="dialog"
              style={dialogPosition}
            >
              <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2.5 text-right">
                <div className="min-h-7 overflow-hidden text-ellipsis whitespace-nowrap text-lg font-semibold tabular-nums text-slate-900">
                  {expression.replaceAll('*', '×').replaceAll('/', '÷')}
                </div>
                <div aria-live="polite" className="min-h-5 text-xs font-medium text-slate-500">
                  {error ?? (result === null ? copy.hint : `= ${result}`)}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                <button
                  aria-label={copy.clear}
                  className={`${keyClass} ${operatorClass}`}
                  onClick={clearCalculation}
                  type="button"
                >
                  C
                </button>
                <button
                  aria-label={copy.backspace}
                  className={`${keyClass} ${operatorClass}`}
                  onClick={backspace}
                  type="button"
                >
                  <BackspaceIcon />
                </button>
                {['÷', '×'].map((operator) => (
                  <button
                    className={`${keyClass} ${operatorClass}`}
                    key={operator}
                    onClick={() => appendOperator(operator)}
                    type="button"
                  >
                    {operator}
                  </button>
                ))}
                {['7', '8', '9'].map((number) => (
                  <button
                    className={`${keyClass} ${numberClass}`}
                    key={number}
                    onClick={() => appendNumber(number)}
                    type="button"
                  >
                    {number}
                  </button>
                ))}
                <button
                  className={`${keyClass} ${operatorClass}`}
                  onClick={() => appendOperator('-')}
                  type="button"
                >
                  −
                </button>
                {['4', '5', '6'].map((number) => (
                  <button
                    className={`${keyClass} ${numberClass}`}
                    key={number}
                    onClick={() => appendNumber(number)}
                    type="button"
                  >
                    {number}
                  </button>
                ))}
                <button
                  className={`${keyClass} ${operatorClass}`}
                  onClick={() => appendOperator('+')}
                  type="button"
                >
                  +
                </button>
                {['1', '2', '3'].map((number) => (
                  <button
                    className={`${keyClass} ${numberClass}`}
                    key={number}
                    onClick={() => appendNumber(number)}
                    type="button"
                  >
                    {number}
                  </button>
                ))}
                <button
                  aria-label={copy.equals}
                  className={`${keyClass} row-span-2 bg-brand-600 font-bold text-white hover:bg-brand-700 focus-visible:ring-brand-600`}
                  onClick={calculate}
                  type="button"
                >
                  =
                </button>
                <button
                  className={`${keyClass} col-span-2 ${numberClass}`}
                  onClick={() => appendNumber('0')}
                  type="button"
                >
                  0
                </button>
                <button
                  className={`${keyClass} ${numberClass}`}
                  onClick={() => appendNumber('.')}
                  type="button"
                >
                  .
                </button>
              </div>

              <button
                className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                onClick={useResult}
                type="button"
              >
                {copy.useResult}
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
