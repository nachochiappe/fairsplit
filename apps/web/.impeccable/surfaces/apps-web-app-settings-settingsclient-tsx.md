---
version: 1
slug: "apps-web-app-settings-settingsclient-tsx"
primary_target: "app/settings/SettingsClient.tsx"
related_targets: ["lib/i18n.ts"]
---

# Category mapping workspace

Scope: the category-management portion of Settings. Visitor mode: Operate.

Audience and job: household members maintaining spending labels. They need to understand the hierarchy, add labels, remap them, and handle exceptions without scanning two oversized disconnected sections.

Chosen direction: Split Mapping Workspace. Approved comp: `.impeccable/mocks/category-map-split-v2.png`.

Direction contract:

- THESIS: Make the category hierarchy visible as one working surface; reject stacked card collections that hide the relationship and consume vertical space.
- OWN-WORLD: Restrained light ledger—pale-blue organizational rail, white working plane, fine slate seams, compact rounded controls, cobalt actions, and semantic category color.
- STORY: See the available groups, scan every detailed label and its usage, then add or remap it inline.
- FIRST VIEWPORT: A 30/70 desktop split with group directory left and mapping ledger right; both creation controls sit directly below their headings.
- FORM: Operate, first-ranked direction, seed `category-map-split`.
- FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md.

Implementation inventory:

| Visible ingredient | Medium | Commitment |
| --- | --- | --- |
| Unified rounded workspace and vertical seam | Semantic HTML/CSS | One outer surface; left rail remains visually subordinate to the ledger. |
| Two-pane 30/70 topology | Responsive CSS grid | Desktop split; stacked panes on narrow screens without horizontal overflow. |
| Headings and supporting copy | Semantic HTML | Equal heading scale, compact descriptions, existing localized content. |
| Super-category directory | Semantic list plus existing inline SVG | Dense rows, icon tile, count badge, system/custom metadata; custom actions remain available. |
| Detailed category ledger | Semantic HTML/CSS grid | Column rhythm for category, usage, mapping, and actions; rows remain compact and scannable. |
| Create and mapping controls | Native inputs/selects/buttons | Preserve forms, validation, keyboard submission, and current API behavior. |
| Category color/icon language | Existing SVG helpers and design tokens | Color supports recognition without becoming decorative chrome. |
| Decorative chevrons and example Travel row | Accepted omission | They imply unsupported navigation/data and must not be literalized. |

Constraints: preserve localization, archived-category restoration, custom-group rename/archive controls, 44px touch targets, keyboard focus, and existing API contracts. No new filters, drag-and-drop, sorting, or category-selection state.

## Household split policy extension

Scope: the expense-split portion of Settings and its read-only summary on the dashboard. Visitor mode: Operate.

- THESIS: Make the household's active fairness rule explicit and editable without implying that underlying expense or income records change.
- OWN-WORLD: Preserve the restrained light-ledger surfaces, cobalt selection and actions, amber consequence notice, tabular numbers, and existing radius/elevation language.
- STORY: Choose income-based or custom splitting, understand the all-month consequence, set exact percentages when needed, then save; the dashboard names the active method and links back to Settings.
- FIRST VIEWPORT: Keep the method choices and consequence notice visible before percentage controls; stack into one ordered column on narrow screens with full-width controls.
- FORM: Use an explicit radio choice rather than a toggle because the two modes are named alternatives. For two-person households, pair one linked slider with exact numeric inputs. Require exactly 100% and connect validation messaging to every percentage control.
- CONSTRAINTS: One policy applies to past, current, and future settlement calculations; records remain unchanged. Preserve localization, keyboard focus, 44px touch targets, and the existing Settings visual system.
