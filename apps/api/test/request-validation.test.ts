import { describe, expect, it } from 'vitest';
import { MAX_ENTITY_ID_LENGTH } from '@fairsplit/shared';
import {
  API_FIELD_LIMITS,
  authLinkSchema,
  createCategorySchema,
  createSuperCategorySchema,
  createUserSchema,
  entityIdSchema,
  expenseListQuerySchema,
  passkeyAuthenticationVerifySchema,
  updateCategorySchema,
  updateSuperCategorySchema,
  upsertMonthlyExchangeRateSchema,
} from '../src/app';
import { computeArsAmount } from '../src/lib/money';

describe('API request field limits', () => {
  it('accepts names at the limit and rejects longer names', () => {
    const nameAtLimit = 'n'.repeat(API_FIELD_LIMITS.name);
    const nameOverLimit = `${nameAtLimit}n`;

    expect(createUserSchema.safeParse({ name: nameAtLimit }).success).toBe(true);
    expect(createUserSchema.safeParse({ name: nameOverLimit }).success).toBe(false);
    expect(createCategorySchema.safeParse({ name: nameOverLimit }).success).toBe(false);
    expect(createSuperCategorySchema.safeParse({ name: nameOverLimit }).success).toBe(false);
  });

  it('bounds expense filters, cursor IDs, and search text', () => {
    const idOverLimit = 'i'.repeat(MAX_ENTITY_ID_LENGTH + 1);
    const searchOverLimit = 's'.repeat(API_FIELD_LIMITS.search + 1);

    expect(
      expenseListQuerySchema.safeParse({ month: '2026-02', categoryId: idOverLimit }).success,
    ).toBe(false);
    expect(
      expenseListQuerySchema.safeParse({ month: '2026-02', paidByUserId: idOverLimit }).success,
    ).toBe(false);
    expect(
      expenseListQuerySchema.safeParse({ month: '2026-02', cursor: idOverLimit, limit: 10 })
        .success,
    ).toBe(false);
    expect(
      expenseListQuerySchema.safeParse({ month: '2026-02', search: searchOverLimit }).success,
    ).toBe(false);
  });

  it('bounds access tokens and super-category metadata', () => {
    expect(
      authLinkSchema.safeParse({ accessToken: 't'.repeat(API_FIELD_LIMITS.accessToken) }).success,
    ).toBe(true);
    expect(
      authLinkSchema.safeParse({ accessToken: 't'.repeat(API_FIELD_LIMITS.accessToken + 1) })
        .success,
    ).toBe(false);
    expect(
      updateSuperCategorySchema.safeParse({ color: 'c'.repeat(API_FIELD_LIMITS.color + 1) })
        .success,
    ).toBe(false);
    expect(updateSuperCategorySchema.safeParse({ icon: 'plane' }).success).toBe(true);
    expect(updateSuperCategorySchema.safeParse({ icon: 'rocket' }).success).toBe(false);
    expect(
      updateSuperCategorySchema.safeParse({ sortOrder: API_FIELD_LIMITS.sortOrder + 1 }).success,
    ).toBe(false);
  });

  it('accepts category icon updates only from the supported vocabulary', () => {
    expect(createCategorySchema.safeParse({ name: 'Travel', icon: 'plane' }).success).toBe(true);
    expect(createCategorySchema.safeParse({ name: 'Travel', icon: 'rocket' }).success).toBe(false);
    expect(updateCategorySchema.safeParse({ icon: 'gift' }).success).toBe(true);
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
  });

  it('bounds WebAuthn credential fields and record sizes', () => {
    const validResponse = {
      id: 'credential',
      rawId: 'credential',
      type: 'public-key',
      response: {},
      clientExtensionResults: {},
    };

    expect(
      passkeyAuthenticationVerifySchema.safeParse({
        response: {
          ...validResponse,
          id: 'c'.repeat(API_FIELD_LIMITS.webauthnCredential + 1),
        },
      }).success,
    ).toBe(false);
    expect(
      passkeyAuthenticationVerifySchema.safeParse({
        response: {
          ...validResponse,
          response: Object.fromEntries(
            Array.from({ length: API_FIELD_LIMITS.webauthnRecordKeys + 1 }, (_, index) => [
              `field-${index}`,
              'value',
            ]),
          ),
        },
      }).success,
    ).toBe(false);
  });

  it('rejects non-finite and out-of-range exchange rates', () => {
    const base = { month: '2026-02', currencyCode: 'USD' };

    expect(
      upsertMonthlyExchangeRateSchema.safeParse({ ...base, rateToArs: 'Infinity' }).success,
    ).toBe(false);
    expect(upsertMonthlyExchangeRateSchema.safeParse({ ...base, rateToArs: 1000 }).success).toBe(
      true,
    );
  });

  it('rejects oversized path IDs with the schema used by the route parameter guard', () => {
    expect(entityIdSchema.safeParse('i'.repeat(MAX_ENTITY_ID_LENGTH)).success).toBe(true);
    expect(entityIdSchema.safeParse('i'.repeat(MAX_ENTITY_ID_LENGTH + 1)).success).toBe(false);
  });
});

describe('ARS amount bounds', () => {
  it('accepts converted amounts within Decimal(14, 2)', () => {
    expect(computeArsAmount('499999999999.99', '2')).toBe('999999999999.98');
  });

  it('rejects converted values that would overflow the database column', () => {
    expect(() => computeArsAmount('999999999999.99', '2')).toThrow(/exceeds the supported limit/);
  });

  it('rejects original amounts and FX rates outside their database precision', () => {
    expect(() => computeArsAmount('1000000000000', '0.5')).toThrow(/amountOriginal exceeds/);
    expect(() => computeArsAmount('1', '0')).toThrow(/fxRate must be greater than 0/);
  });

  it.each(['Infinity', '-Infinity', 'not-money'])(
    'rejects invalid or non-finite decimal input: %s',
    (value) => {
      expect(() => computeArsAmount(value, '1')).toThrow(/finite decimal/);
    },
  );
});
