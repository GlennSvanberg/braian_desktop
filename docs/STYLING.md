# Styling reference (Braian Desktop)

## Source of truth

All design tokens and global rules live in a **single stylesheet**:

- `[src/styles/app.css](../src/styles/app.css)`

Do **not** introduce one-off hex colors in components unless you are mapping a new token in `app.css` first (see [AGENTS.md](../AGENTS.md)).

## Themes

- **Mechanism:** `localStorage` key `theme` with values `light`, `dark`, or `auto`. A small inline script in `[src/routes/__root.tsx](../src/routes/__root.tsx)` runs before paint and sets `class="light"` or `class="dark"` on `<html>`.
- **Default before script:** `html:not(.light):not(.dark)` uses the **dark** palette (matches the original Braian web prototype).

## Palette overview

Neutrals and semantic colors (`success`, `warning`, `danger`, `info`) follow the Braian prototype (`C:\git\glenn\braian\app\src\styles\app.css`). The **primary accent is green** (`#3e8e6c` family), not the prototype’s steel-blue accent scale.


| Role                    | Dark (`html.dark`)                          | Light (`html.light`) |
| ----------------------- | ------------------------------------------- | -------------------- |
| App background (`bg-0`) | `#0f1114`                                   | `#f4f3ef`            |
| Surface (`bg-1`)        | `#151a1f`                                   | `#eceae4`            |
| Raised / hover (`bg-2`) | `#1b2229`                                   | `#e3e0d8`            |
| Border                  | `#222a32`                                   | `#d4d0c6`            |
| Primary text            | `#f2f2ee`                                   | `#1a1c18`            |
| Body text               | `#cbc7be`                                   | `#3d3f3a`            |
| Muted text              | `#8f8a80`                                   | `#6b6e66`            |
| Accent (primary)        | `#3e8e6c` (scale `accent-200`–`accent-700`) | same green scale     |


## Tailwind + shadcn/ui

- Tailwind v4 reads tokens from `@theme inline` in `app.css`. Semantic utilities include `bg-background`, `text-foreground`, `bg-primary`, `border-border`, and Braian-style aliases like `bg-bg-0`, `text-text-1`.
- shadcn/ui components use CSS variables (`--primary`, `--background`, …) that are wired to the same `--app-`* variables in `app.css`.

## Adding new UI

1. Extend `app.css` (`@theme inline` and/or `html.light` / `html.dark` `--app-*` variables).
2. Use Tailwind utilities referencing those tokens.
3. Update this doc if you add a new token category.