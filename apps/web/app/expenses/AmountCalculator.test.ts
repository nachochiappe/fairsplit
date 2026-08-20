import { describe, expect, it } from 'vitest';
import { getCalculatorKeyboardAction } from './AmountCalculator';

describe('getCalculatorKeyboardAction', () => {
  it('maps numeric keypad digits and operators', () => {
    expect(getCalculatorKeyboardAction('7', 'Numpad7', false)).toEqual({
      type: 'append-number',
      value: '7',
    });
    expect(getCalculatorKeyboardAction('+', 'NumpadAdd', false)).toEqual({
      type: 'append-operator',
      value: '+',
    });
    expect(getCalculatorKeyboardAction('*', 'NumpadMultiply', false)).toEqual({
      type: 'append-operator',
      value: '×',
    });
    expect(getCalculatorKeyboardAction('/', 'NumpadDivide', false)).toEqual({
      type: 'append-operator',
      value: '÷',
    });
  });

  it('supports both decimal separators and keyboard calculation controls', () => {
    expect(getCalculatorKeyboardAction(',', 'Comma', false)).toEqual({
      type: 'append-number',
      value: '.',
    });
    expect(getCalculatorKeyboardAction('.', 'NumpadDecimal', false)).toEqual({
      type: 'append-number',
      value: '.',
    });
    expect(getCalculatorKeyboardAction('Enter', 'NumpadEnter', false)).toEqual({
      type: 'calculate',
    });
    expect(getCalculatorKeyboardAction('Backspace', 'Backspace', false)).toEqual({
      type: 'backspace',
    });
    expect(getCalculatorKeyboardAction('c', 'KeyC', false)).toEqual({ type: 'clear' });
  });

  it('does not intercept modified shortcuts or unrelated keys', () => {
    expect(getCalculatorKeyboardAction('c', 'KeyC', true)).toBeNull();
    expect(getCalculatorKeyboardAction('Tab', 'Tab', false)).toBeNull();
    expect(getCalculatorKeyboardAction('Escape', 'Escape', false)).toBeNull();
  });
});
