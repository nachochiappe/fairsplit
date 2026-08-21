---
name: Fairsplit
description: Calm, clear household finance for fair monthly sharing.
colors:
  canvas: '#f8fbff'
  ink-strong: '#0f1b35'
  ink-base: '#334155'
  ink-muted: '#475569'
  ink-soft: '#64748b'
  surface: '#ffffff'
  surface-soft: '#eef4ff'
  surface-muted: '#f8fafc'
  stroke: '#d9e3f3'
  trust-blue-wash: '#eff6ff'
  trust-blue-soft: '#dbeafe'
  trust-blue-mid: '#3b82f6'
  trust-blue: '#2563eb'
  trust-blue-deep: '#1d4ed8'
  housing-indigo: '#4f46e5'
  lifestyle-green: '#10b981'
  essentials-amber: '#f59e0b'
  mobility-cyan: '#0891b2'
  finance-violet: '#7c3aed'
  other-slate: '#64748b'
  positive: '#059669'
  negative: '#f43f5e'
  warning: '#92400e'
  danger: '#b91c1c'
typography:
  display:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: 'clamp(1.875rem, 4vw, 3rem)'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '-0.025em'
  headline:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: '2.25rem'
    fontWeight: 700
    lineHeight: 1.111
    letterSpacing: '-0.025em'
  title:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: '-0.025em'
  body:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 'normal'
  label:
    fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 700
    lineHeight: 1.333
    letterSpacing: '0.16em'
rounded:
  sm: '4px'
  field-sm: '6px'
  control: '8px'
  control-large: '12px'
  panel: '16px'
  mobile-nav-item: '20px'
  hero: '24px'
  mobile-nav: '26px'
  pill: '9999px'
spacing:
  '1': '4px'
  '2': '8px'
  '3': '12px'
  '4': '16px'
  '5': '20px'
  '6': '24px'
  '7': '28px'
  '8': '32px'
  '9': '36px'
  '10': '40px'
components:
  button-primary:
    backgroundColor: '{colors.trust-blue}'
    textColor: '{colors.surface}'
    typography: '{typography.body}'
    rounded: '{rounded.control-large}'
    padding: '10px 16px'
    height: '44px'
  button-primary-hover:
    backgroundColor: '{colors.trust-blue-deep}'
    textColor: '{colors.surface}'
    rounded: '{rounded.control-large}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink-base}'
    typography: '{typography.body}'
    rounded: '{rounded.control-large}'
    padding: '10px 16px'
    height: '44px'
  field:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink-strong}'
    typography: '{typography.body}'
    rounded: '{rounded.control-large}'
    padding: '10px 16px'
    height: '44px'
  surface-card:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink-base}'
    rounded: '{rounded.hero}'
    padding: '24px'
  nav-desktop-active:
    backgroundColor: '{colors.trust-blue}'
    textColor: '{colors.surface}'
    rounded: '{rounded.control-large}'
    padding: '12px 16px'
  nav-mobile-active:
    backgroundColor: '{colors.trust-blue-wash}'
    textColor: '{colors.trust-blue-deep}'
    rounded: '{rounded.mobile-nav-item}'
    padding: '8px'
    height: '56px'
  chip-active:
    backgroundColor: '{colors.trust-blue-wash}'
    textColor: '{colors.trust-blue-deep}'
    rounded: '{rounded.pill}'
    padding: '8px 12px'
    height: '40px'
  title-mark:
    backgroundColor: '{colors.stroke}'
    rounded: '{rounded.control-large}'
    size: '48px'
---

# Design System: Fairsplit

## Overview

**Creative North Star: "The Clear Ledger"**

Fairsplit is a calm, light-mode financial workspace where shared money feels understandable rather than clinical. The Clear Ledger pairs crisp accounting structure with softly rounded surfaces and a restrained blue trust signal, making the current month, the household total, and each partner's fair position easy to scan without recreating the pressure of a spreadsheet.

The interface is softly layered rather than decorative. Cool white and pale blue surfaces organize dense financial information; fine borders do most of the structural work; ambient shadows only separate important planes. The system should feel calm, dependable, and touch-friendly, with warmth coming from the faint canvas glow, the small prism mark, and functional category colors—not from ornament or novelty.

**Key Characteristics:**

- Light-mode first with a cool, open canvas and clean white work surfaces.
- Large, tabular financial totals supported by compact labels and restrained body copy.
- Rounded, touch-friendly controls and containers with precise border hierarchy.
- Trust Blue reserved for current state, primary action, focus, and important guidance.
- Functional accent colors identify spending categories and financial status without dominating the page.
- Responsive information density: tables and horizontal navigation on desktop; cards and a fixed bottom navigation on mobile.

## Colors

The palette uses cool ledger neutrals for structure, one dependable blue for action and orientation, and functional accents only when they carry category or status meaning.

### Primary

- **Trust Blue** (`#2563eb`): Primary actions, active desktop navigation, focus rings, and the clearest interactive emphasis.
- **Deep Trust Blue** (`#1d4ed8`): Hover states, high-emphasis labels, and active text on pale blue surfaces.
- **Trust Blue Mid** (`#3b82f6`): Focused field borders and intermediate brand emphasis.
- **Trust Blue Soft** (`#dbeafe`): The cool atmospheric wash and gentle brand-tinted separation.
- **Trust Blue Wash** (`#eff6ff`): Selected mobile navigation, active filter chips, and quiet guidance panels.

### Secondary

- **Housing Indigo** (`#4f46e5`): Housing category identity.
- **Lifestyle Green** (`#10b981`): Lifestyle category identity.
- **Essentials Amber** (`#f59e0b`): Essentials category identity.
- **Mobility Cyan** (`#0891b2`): Mobility category identity.
- **Finance Violet** (`#7c3aed`): Finance category identity.
- **Other Slate** (`#64748b`): Uncategorized or fallback category identity.
- **Positive Green** (`#059669`): Favorable balances and successful outcomes.
- **Negative Rose** (`#f43f5e`): Unfavorable monthly differences where the sign itself matters.
- **Warning Brown** (`#92400e`): Warning copy on amber-toned status surfaces.
- **Danger Red** (`#b91c1c`): Destructive actions and error copy.

### Neutral

- **Canvas** (`#f8fbff`): The page background beneath all work surfaces.
- **Ledger Ink** (`#0f1b35`): Page titles, major totals, and the strongest financial statements.
- **Body Slate** (`#334155`): Default body copy and secondary controls.
- **Muted Slate** (`#475569`): Explanatory copy that remains comfortably readable.
- **Soft Slate** (`#64748b`): Labels, metadata, inactive navigation, and placeholders.
- **Paper** (`#ffffff`): Cards, dialogs, fields, and navigation surfaces.
- **Cool Blue Surface** (`#eef4ff`): Quiet inset panels and gentle selected regions.
- **Ledger Mist** (`#f8fafc`): Table headers, hover rows, and nested neutral surfaces.
- **Cool Rule** (`#d9e3f3`): Default separators, outlines, and container borders.

### Named Rules

**The One Trust Signal Rule.** Trust Blue is the only general-purpose accent; use it for action, focus, and current state, never as broad decoration.

**The Category Color Stays Categorical Rule.** Housing, lifestyle, essentials, mobility, finance, and other accents identify data; they do not replace Trust Blue for navigation or generic controls.

**The Meaning Before Hue Rule.** Positive, negative, warning, and danger colors must retain a readable text label or numeric sign so color never carries meaning alone.

## Typography

**Display Font:** Platform UI sans (with `ui-sans-serif`, `system-ui`, and platform sans fallbacks)

**Body Font:** Platform UI sans (with `ui-sans-serif`, `system-ui`, and platform sans fallbacks)

**Character:** The rendered single-family system is modern, quiet, and highly legible. Weight, scale, spacing, and tabular numerals create hierarchy without introducing a decorative display face or finance-dashboard stiffness. A local Geist variable font is bundled, but the current body `font-sans` utility resolves to the platform system stack; new work should follow the rendered stack unless the implementation deliberately activates Geist across the app.

### Hierarchy

- **Display** (700, `clamp(1.875rem, 4vw, 3rem)`, `1`): App-shell titles and the most important screen identity; track tightly and keep the line count short.
- **Headline** (700, `2.25rem`, `1.111`): Major financial totals and dense metric values.
- **Title** (600, `1.25rem`, `1.4`, `-0.025em`): Primary section headings and modal titles. Nested card headings step down to `1.125rem`; field labels use the established `0.875rem` form treatment rather than title styling.
- **Body** (400, `1rem`, `1.5`): Instructions, descriptions, form values, and default reading text; use medium or semibold weight for actionable content.
- **Label** (700, `0.75rem`, `0.16em`, uppercase): Brand eyebrow, metric labels, compact table headers, and month context. Use sparingly so letterspaced uppercase text stays scannable.

### Named Rules

**The Fairness Is Numeric Rule.** Monetary values, percentages, rates, and date-like controls use tabular numerals and strong alignment so partners can compare amounts without visual jitter.

**The Quiet Type Rule.** Hierarchy comes from weight and size within one platform sans family; repeated roles keep identical treatment, and semantic nesting—not component ownership—determines the step. Do not add a second typeface, decorative italics, or oversized editorial display treatments.

## Layout

The authenticated workspace uses a centered fluid shell capped at `1400px`, with `16px` page gutters on small screens and `24px` from the medium breakpoint. The shell starts `32px` from the top on mobile and `40px` on larger screens. Its header and primary content panel are separate rounded planes, generally using `24px` internal padding and expanding to `36px` in the most prominent desktop header.

Spacing follows a `4px` base rhythm, with `8px`, `12px`, `16px`, `20px`, `24px`, and `32px` doing most of the work. Use compact gaps inside controls, medium gaps inside cards, and the largest gaps between distinct financial sections. Dense data should remain aligned and grouped rather than being spread out merely to fill a wide viewport.

At `768px` and above, primary navigation is a four-column horizontal surface, metric summaries may use three columns, and financial comparisons use tables with right-aligned numbers. Below that breakpoint, tables become stacked cards, controls wrap or become full-width, and navigation becomes a fixed, safe-area-aware bottom dock. Interactive targets are at least `44px`; mobile content leaves enough bottom padding to clear the dock.

**The Month Is the Frame Rule.** Keep the selected month visually adjacent to the screen title and preserve it across month-scoped navigation; the current month is the organizing frame for every financial task.

## Elevation & Depth

Fairsplit is softly layered. Fine cool borders and small tonal shifts establish structure at rest; low ambient shadows separate cards without making them float. Stronger shadows are reserved for overlays, the mobile navigation dock, and the small prism mark. Blur belongs only to the mobile dock backdrop and transient loading or modal layers.

### Shadow Vocabulary

- **Surface Low** (`0 1px 2px 0 rgba(0, 0, 0, 0.05)`): Default headers, cards, fields, and content panels.
- **Active Brand** (`0 4px 6px -1px rgba(29, 78, 216, 0.25), 0 2px 4px -2px rgba(29, 78, 216, 0.25)`): Active desktop navigation only.
- **Prism Mark** (`0 4px 12px rgba(15, 23, 42, 0.16)`): The compact brand mark's tactile separation.
- **Mobile Dock** (`0 18px 48px rgba(15, 23, 42, 0.18)`): Fixed bottom navigation above page content.
- **Dialog** (`0 20px 25px -5px rgba(0, 0, 0, 0.10), 0 8px 10px -6px rgba(0, 0, 0, 0.10)`): Modal dialogs against the dimmed viewport.

### Named Rules

**The Soft Layer Rule.** Borders and tonal surfaces create hierarchy first; add shadow only when a plane genuinely sits above another plane.

**The Overlay Earns Depth Rule.** Strong elevation is limited to dialogs, the mobile dock, and the prism mark—never routine content cards.

## Shapes

The form language moves from gently rounded controls to generously rounded containers. Compact utility controls use `6px`–`8px` corners; primary fields and buttons use `12px`; nested panels and data sections use `16px`; page-defining cards and headers use `24px`. Pills are reserved for statuses, filters, toggles, and compact categorical identities. Thin `1px` borders keep the curves precise rather than soft or toy-like.

The prism mark is the intentional exception: a slightly rotated rounded square crossed by a teal-to-violet diagonal ribbon. It is the only decorative geometry and should remain compact, crisp, and isolated from the data visualization language.

**The Radius Signals Scale Rule.** Larger spatial containers receive larger radii; do not apply the `24px` hero radius indiscriminately to small controls or dense table elements.

## Components

Components feel calm, dependable, and touch-friendly. State changes are clear but restrained, using `200ms ease` color, border, and shadow transitions and a consistent two-pixel Trust Blue focus outline with a two-pixel offset. Respect reduced-motion preferences globally.

### Buttons

- **Shape:** Primary and high-visibility secondary actions use a generous control radius (`12px`) and a minimum touch height (`44px`); compact table actions may use `8px`.
- **Primary:** Trust Blue background, Paper text, semibold or bold label, and horizontal padding of `16px`–`24px` depending on prominence.
- **Hover / Focus:** Hover deepens to Deep Trust Blue. Keyboard focus uses a two-pixel Trust Blue ring with a two-pixel offset; disabled buttons keep their geometry and reduce opacity.
- **Secondary:** Paper background, cool gray border, Body Slate text, and a Ledger Mist hover.
- **Destructive / Contextual:** Red and amber treatments are limited to delete, remove, or archive actions and retain visible text or an accessible label.

### Chips

- **Style:** Compact pill shape, `40px` touch height where interactive, `12px` horizontal padding, and semibold small text.
- **State:** Selected filters use Trust Blue Wash, Deep Trust Blue text, and a quiet blue border. Unselected filters stay on Paper with a cool gray border.

### Cards / Containers

- **Corner Style:** Major headers and metric cards use the hero radius (`24px`); nested data sections generally use the panel radius (`16px`).
- **Background:** Paper for primary work surfaces, Ledger Mist or Cool Blue Surface for nested and selected regions.
- **Shadow Strategy:** Surface Low at rest; rely on Cool Rule borders for most separation.
- **Border:** One-pixel cool borders, often slightly translucent when layered on Paper.
- **Internal Padding:** Usually `20px`–`24px`, expanding to `32px`–`36px` for prominent desktop sections.

### Inputs / Fields

- **Style:** Paper fill, cool gray one-pixel stroke, `8px`–`12px` radius, readable `16px` text on mobile, and a minimum `44px` height.
- **Focus:** Trust Blue ring and, in denser income forms, a Trust Blue Mid border with a subtle translucent ring.
- **Error / Disabled:** Errors use an explicit message in a pale red bordered panel. Disabled controls preserve contrast, reduce opacity, and communicate wait or unavailable state through cursor and copy.

### Navigation

Desktop navigation is a bordered four-column Paper surface. Each item stacks a simple stroke icon above a semibold label; the current item becomes Trust Blue with Paper text and a compact brand shadow. Mobile navigation is a fixed, safe-area-aware Paper dock with a `26px` outer radius; the current item uses Trust Blue Wash, Deep Trust Blue text, and an inset keyline instead of a filled button.

### Month Selector

The month selector combines a native month field with square previous and next controls. Each control is at least `44px`, uses a Paper surface, cool border, subtle shadow, and explicit accessible label. During navigation, preserve the pending month, show a small spinner and status copy, and soften the content plane rather than replacing the whole page.

### Prism Title Mark

Use the prism mark beside app identity and major entry points, generally at `40px`–`56px`. Preserve its rotated square, restrained gray base, diagonal teal-to-violet ribbon, soft highlight, and compact shadow. Do not reuse the ribbon as a generic gradient treatment elsewhere.

## Do's and Don'ts

### Do:

- **Do** make month-to-date totals, partner differences, and the settlement statement the strongest visual information.
- **Do** use Paper, Ledger Mist, Cool Blue Surface, and Cool Rule borders to group dense financial information before adding shadow.
- **Do** keep controls touch-friendly, keyboard-visible, and responsive; maintain `44px` targets and mobile safe-area clearance.
- **Do** use tabular numerals and right alignment for comparable monetary values.
- **Do** let category and status colors carry a specific functional label, sign, or data relationship.
- **Do** preserve the light-mode-first, calm, clear visual character across new screens.

### Don't:

- **Don't** turn Trust Blue or the category palette into decorative gradients, oversized color fields, or generic dashboard chrome.
- **Don't** introduce a second font, glass-heavy surfaces, neon accents, or ornamental data visualizations.
- **Don't** make every container a floating card; use spacing, borders, and nested tonal surfaces to keep hierarchy quiet.
- **Don't** shrink mobile controls below `44px` or force desktop tables into narrow viewports.
- **Don't** use color alone to communicate who owes, who paid more, an error, or a destructive consequence.
- **Don't** duplicate the prism ribbon across buttons, charts, backgrounds, or unrelated decorative elements.
