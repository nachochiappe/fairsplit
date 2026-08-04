/**
 * Public-input limits shared by validation and domain logic.
 *
 * Money and FX limits mirror the largest values supported by the corresponding
 * PostgreSQL Decimal(14, 2) and Decimal(14, 6) columns.
 */
export const MAX_MONEY_AMOUNT = 999_999_999_999.99;
export const MAX_FX_RATE = 99_999_999.999999;

// Ten years of monthly payments is deliberately generous for household purchases.
export const MAX_INSTALLMENT_COUNT = 120;

export const MAX_INCOME_ENTRIES_PER_USER_MONTH = 100;
export const MAX_DESCRIPTION_LENGTH = 240;
export const MAX_ENTITY_ID_LENGTH = 128;
