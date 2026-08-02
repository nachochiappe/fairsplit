# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Fairsplit is primarily for couples who share household expenses. They use it throughout the month to record purchases with little effort and to understand their combined spending and each partner's fair position without relying on spreadsheets or repeated money conversations.

## Product Purpose

Fairsplit makes shared spending visible, understandable, and fair. It combines expense tracking, income-aware contribution ratios, currency conversion, and settlement guidance so a household can see where it stands now and settle with confidence. Success means adding an ordinary expense takes little thought and the current month's financial position is immediately legible.

## Positioning

Fairsplit does not assume that fair means equal. It calculates each partner's share from their proportion of household income, normalizes multi-currency spending to ARS, and turns the month's activity into a clear contribution and settlement position.

## Operating Context

- Expense capture is a frequent, lightweight activity performed during the month, commonly on mobile.
- Month-to-date review is the primary orientation; the selected month is preserved across expenses, incomes, and dashboard navigation.
- Expenses may be one-time, recurring, or installment-based and may be paid in ARS or another supported currency.
- Users occasionally search, filter, edit, clone, or delete expenses and maintain monthly exchange rates.
- Couples review accumulated spending and fair contributions together, then use the settlement recommendation to resolve the difference.

## Capabilities and Constraints

- The expenses surface must prioritize rapid daily capture and immediate understanding of month-to-date household spending.
- The expenses surface should make each partner's fair position visible, not only the combined expense total.
- Exchange-rate editing, pagination, and advanced filters are secondary tools that should remain available without dominating the default experience.
- Income ratios determine fair shares; monetary calculations use decimal arithmetic rather than JavaScript floating-point numbers.
- ARS is the settlement base currency, with monthly exchange rates used to normalize foreign-currency expenses.
- The interface supports English and Argentine Spanish and must accommodate localized labels and number formats.
- Authentication uses Supabase sessions; household financial data is private and scoped to authenticated users.

## Brand Commitments

- Product name: Fairsplit.
- Personality: spend, fair, clear.
- The experience should feel calm, controlled, trustworthy, practical, and product-specific.
- Light mode is the primary visual environment.
- Soft surfaces, rounded forms, and a restrained blue trust signal are established brand assets, but generic dashboard styling and ornamental finance visuals should be avoided.

## Evidence on Hand

- The working product and its real expense, income, category, exchange-rate, and settlement data models.
- Existing English and Argentine Spanish product copy in `lib/i18n.ts`.
- Existing prism title mark and authenticated application shell.
- No testimonials, external benchmarks, customer logos, or marketing claims are available and future work must not fabricate them.

## Product Principles

1. Make the current month understandable at a glance.
2. Make fairness visible wherever shared spending is reviewed.
3. Keep everyday capture faster than spreadsheet entry.
4. Reveal financial complexity only when the task requires it.
5. Reduce ambiguity with explicit amounts, ownership, status, and feedback.

## Accessibility & Inclusion

The product must remain keyboard-operable, support visible focus states and reduced-motion preferences, preserve at least 44px touch targets, and never rely on color alone to communicate financial meaning or status.
