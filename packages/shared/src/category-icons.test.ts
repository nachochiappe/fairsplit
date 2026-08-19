import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ICON_KEYS,
  inferCategoryIcon,
  isCategoryIconKey,
  resolveCategoryIcon,
} from './category-icons';

describe('category icons', () => {
  it.each([
    ['Alquiler', 'home'],
    ['Supermercado', 'cart'],
    ['Nafta', 'car'],
    ['Internet', 'wifi'],
    ['Gatitas', 'paw'],
    ['Viajes', 'plane'],
    ['Regalos', 'gift'],
    ['Gimnasio', 'dumbbell'],
    ['Café', 'coffee'],
    ['Salud', 'medical'],
  ] as const)('infers %s as %s', (name, expected) => {
    expect(inferCategoryIcon(name)).toBe(expected);
  });

  it('uses a neutral receipt when no keyword matches', () => {
    expect(inferCategoryIcon('Something very specific')).toBe('receipt');
  });

  it('accepts only icons in the public vocabulary', () => {
    expect(isCategoryIconKey('plane')).toBe(true);
    expect(isCategoryIconKey('rocket')).toBe(false);
    expect(CATEGORY_ICON_KEYS).toHaveLength(22);
  });

  it('keeps a user selection and replaces invalid stored values with an inference', () => {
    expect(resolveCategoryIcon('gift', 'Viajes')).toBe('gift');
    expect(resolveCategoryIcon('unknown', 'Viajes')).toBe('plane');
  });
});
