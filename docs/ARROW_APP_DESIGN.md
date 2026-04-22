# Braian Arrow app design (main.css)

Workspace Arrow apps render inside **`@arrow-js/sandbox`** with **Shadow DOM** by default (`ArrowWorkspaceSandbox`). The host shell uses Tailwind tokens (`bg-app-bg-0`, etc.), but **styles do not cross into the shadow tree** from the parent document. Each app should ship **`main.css`** with its own tokens and components so previews **match Braian’s green-accent neutral palette** ([STYLING.md](STYLING.md), source: [`src/styles/app.css`](../src/styles/app.css)).

## Theme caveat (light / dark)

- Braian switches theme with **`html.light`** / **`html.dark`**. Selectors like `html.dark .my-app` **do not** style content inside the sandbox shadow root.
- **Practical v1:** Default **`main.css` to the dark Braian palette** (matches `html:not(.light):not(.dark)` and `html.dark` in the shell).
- **Optional:** Duplicate a **light** palette under `@media (prefers-color-scheme: light)` so OS-light users get a coherent card (imperfect vs shell if the user forces light shell on a dark OS).
- **Future (host):** Passing `data-theme` on the mount node and using `:host([data-theme="light"]) { … }` would track the shell exactly — not implemented in the host today.

## Design principles

- **Neutrals + green primary** — same as the desktop app (`#3e8e6c` accent family), not arbitrary blues.
- **Readable contrast** — primary text on bg-0; muted text for hints (`--ba-text-3`).
- **Tight radius** — `0.5rem` cards/buttons to align with shadcn-ish chrome (`rounded-lg` feel).
- **Focus visible** — ring using accent color for keyboard users.

Hex values below mirror **`html.dark`** / **`html.light`** in `src/styles/app.css` (January 2026).

---

## Copy-paste: design tokens on `:host`

Put this at the **top** of `main.css`. Shadow roots use **`:host`** as the selector root.

```css
/* Dark (default) — matches Braian html.dark */
:host {
  color-scheme: dark;
  --ba-bg-0: #0f1114;
  --ba-bg-1: #151a1f;
  --ba-bg-2: #1b2229;
  --ba-border: #222a32;
  --ba-text-1: #f2f2ee;
  --ba-text-2: #cbc7be;
  --ba-text-3: #8f8a80;
  --ba-accent: #3e8e6c;
  --ba-accent-hover: #347a5d;
  --ba-accent-muted: #c8e8d4;
  --ba-danger: #b85a5a;
  --ba-warning: #b08b4a;
  --ba-radius: 0.5rem;
  --ba-font: ui-sans-serif, system-ui, sans-serif;
  box-sizing: border-box;
  font-family: var(--ba-font);
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--ba-text-2);
  background: var(--ba-bg-0);
}

*, *::before, *::after {
  box-sizing: inherit;
}

@media (prefers-color-scheme: light) {
  :host {
    color-scheme: light;
    --ba-bg-0: #f4f3ef;
    --ba-bg-1: #eceae4;
    --ba-bg-2: #e3e0d8;
    --ba-border: #d4d0c6;
    --ba-text-1: #1a1c18;
    --ba-text-2: #3d3f3a;
    --ba-text-3: #6b6e66;
    --ba-accent: #3e8e6c;
    --ba-accent-hover: #347a5d;
    --ba-accent-muted: #b8e5cc;
    --ba-danger: #b85a5a;
    --ba-warning: #b08b4a;
    color: var(--ba-text-2);
    background: var(--ba-bg-0);
  }
}
```

---

## Typography

```css
:host h1,
:host h2,
:host h3 {
  font-weight: 600;
  color: var(--ba-text-1);
  line-height: 1.25;
  margin: 0 0 0.5rem;
}

:host h1 { font-size: 1.375rem; }
:host h2 { font-size: 1.125rem; }
:host h3 { font-size: 1rem; }

:host p {
  margin: 0 0 0.75rem;
}

:host a {
  color: var(--ba-accent);
  text-decoration: none;
}
:host a:hover {
  text-decoration: underline;
  color: var(--ba-accent-hover);
}
```

---

## Layout and surfaces

```css
/* Wrap root content: <main class="ba-app">…</main> */
:host .ba-app {
  min-height: 100%;
  padding: 1rem;
  background: var(--ba-bg-0);
}

:host .ba-card {
  background: var(--ba-bg-1);
  border: 1px solid var(--ba-border);
  border-radius: var(--ba-radius);
  padding: 1rem;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ba-text-1) 6%, transparent);
}

:host .ba-muted {
  font-size: 0.8125rem;
  color: var(--ba-text-3);
}
```

---

## Buttons (primary / secondary / ghost)

```css
:host .ba-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.45rem 0.85rem;
  font: inherit;
  font-weight: 500;
  border-radius: calc(var(--ba-radius) - 2px);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

:host .ba-btn:focus-visible {
  outline: 2px solid var(--ba-accent);
  outline-offset: 2px;
}

:host .ba-btn--primary {
  background: var(--ba-accent);
  color: #f7faf8;
  border-color: color-mix(in srgb, var(--ba-accent) 88%, black);
}
:host .ba-btn--primary:hover {
  background: var(--ba-accent-hover);
}

:host .ba-btn--secondary {
  background: var(--ba-bg-2);
  color: var(--ba-text-1);
  border-color: var(--ba-border);
}
:host .ba-btn--secondary:hover {
  filter: brightness(1.06);
}

:host .ba-btn--ghost {
  background: transparent;
  color: var(--ba-text-2);
  border-color: transparent;
}
:host .ba-btn--ghost:hover {
  background: color-mix(in srgb, var(--ba-text-1) 6%, transparent);
  color: var(--ba-text-1);
}
```

---

## Form fields

```css
:host .ba-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.85rem;
}

:host .ba-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--ba-text-1);
}

:host .ba-input,
:host .ba-textarea {
  width: 100%;
  max-width: 100%;
  padding: 0.5rem 0.65rem;
  font: inherit;
  color: var(--ba-text-1);
  background: var(--ba-bg-0);
  border: 1px solid var(--ba-border);
  border-radius: calc(var(--ba-radius) - 2px);
}

:host .ba-input:focus-visible,
:host .ba-textarea:focus-visible {
  outline: 2px solid var(--ba-accent);
  outline-offset: 0;
  border-color: var(--ba-accent);
}

:host .ba-textarea {
  min-height: 5rem;
  resize: vertical;
}
```

---

## Semantic status colors

Use sparingly for validation or banners:

- **Success / primary actions:** `var(--ba-accent)` (same green as the shell).
- **Danger:** `var(--ba-danger)`.
- **Warning:** `var(--ba-warning)`.

---

## Checklist before `write_arrow_app`

1. Include **`main.css`** with at least the **`:host` token block** for non-trivial UI.
2. Root template wraps interactive UI in **`<main class="ba-app">`** (or equivalent) so padding/background fill the preview.
3. Use **`ba-btn ba-btn--primary`** (etc.) or the same hex roles — avoid unrelated color systems.
4. Prefer **semantic HTML** (`button`, `label`, `input`, `main`, `section`) for accessibility.

## See also

- [ARROW_APPS.md](ARROW_APPS.md) — tools and runtime.
- [ARROW_SANDBOX_SUBSET.md](ARROW_SANDBOX_SUBSET.md) — `main.ts` contract.
- [STYLING.md](STYLING.md) — shell token naming (Tailwind side).
