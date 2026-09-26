# R1FT Client copy and UI review

Reviewed 2026-09-25 with no-ai-slop, Hallmark audit, and unslop-ui.

The launcher has a clear product layout: navigation rail, account sidebar, news, and instance library. It follows `assets/home.png`; replacing it with a landing-page theme would not help. The highest-impact remaining change is text contrast, especially the small white labels on red buttons and dim empty-state instructions.

## Copy changes applied

Edited launcher-owned text in `src/app.js`. Mojang posts and Modrinth authors' descriptions remain unchanged.

| Before | After |
| --- | --- |
| Every adventure starts somewhere. | No instances yet |
| Find your next adventure. | Modpacks |
| Make it your Minecraft. | Mods, resource packs & shaders |
| Choose who’s heading into the next adventure. | Select the account to use when launching Minecraft. |
| A few small adjustments. A better way to play. | Set Minecraft’s memory limit, Java runtime, and launch preferences. |
| A new world deserves a fresh start. | Choose a Minecraft version and mod loader. |
| Finding your next favorite… | Loading Modrinth projects… |
| News is taking a break. | Could not load Minecraft news |
| A little room for something new. | No mods/resource packs/shader packs installed. |
| A fresh look starts here. | No skins imported |
| Ready when you are | Never played |

Removed the home-page slogan and decorative introductory labels on Home, Accounts, Settings, and Modrinth pages. Kept “Let’s play.” because it is short, appropriate to a launcher, and does not obscure the task. Help now names the steps: add an account, create an instance, launch Minecraft. Sign-in copy states the Java ownership requirement and distinguishes online-mode servers from servers that accept offline accounts.

The no-ai-slop edit check passes: no invented claims, no inflated promise, concrete empty states and loading messages, and the existing friendly tone retained.

## UI findings

The stylesheet is mostly on line 1, so selectors identify the exact rules below. This was a visual audit, not a stylesheet redesign.

### Critical: Text contrast

`src/style.css:1`, `.primary`, `.content-empty`, `.account-note`.

White text on the primary red `#ff292f` has a computed contrast ratio of 3.74:1. Empty-state text `#585863` on `#111113` is 2.69:1. Sidebar text `#74747c` on `#141416` is 3.97:1. These are small text, below the 4.5:1 normal-text target. The screenshots confirm that empty-state instructions and sidebar explanations are hard to read.

Fix: use a darker red for filled buttons with white labels, brighten secondary instructional text, and increase essential 9–11px labels. Preserve the red brand accent for non-text uses. Check actual foreground/background pairs after the change.

### Major: Unspecified typography (Hallmark's “Inter-everywhere”)

`src/style.css:1`, `:root`; `index.html:1`.

The stack starts with Inter, then Segoe UI and Arial. The project neither bundles Inter nor loads a font stylesheet, so the result depends on fonts installed on the user's machine. A native UI font can be a deliberate choice for a desktop utility; adding a display font only to satisfy a rule is unnecessary.

Fix: choose and document a compact desktop UI family, bundle it for consistent rendering, and retain a monospace face for logs. Verify Windows, macOS, and Linux glyph coverage. Do not rotate fonts or change the brand just to reduce a scanner score.

### Major: Wrapped clickable labels

`src/app.js:55`, category buttons; `src/style.css:1`, `.categories`, `.filter-option`.

“World generation” wraps into two centered lines in the narrow category grid at the default window size. It breaks the alignment of the neighboring filter controls.

Fix: give categories a full-width list or use the shorter label “Worldgen” with an accessible full name. Let the container reflow rather than hiding useful text.

### Minor: Decorative glow

`src/style.css:1`, `.primary`, `.primary:hover`, `.voxel-sun`.

Primary buttons have a faint red shadow. The offline news illustration also uses a large sun glow. The scanner groups these under “Unprompted neon glow shadow,” but the illustration's sun has a concrete visual role; this is not a neon treatment across the interface.

Fix: remove the button halo if refining the control styles. Keep or soften the illustrated sunlight according to the supplied Minecraft reference; do not suppress the scanner blindly.

## What already works

- The layout serves a desktop launcher, not a centered marketing hero and three feature cards.
- The dark/red palette and side rail follow the user's reference.
- Lucide supplies a consistent icon set; the native window controls perform real Electron actions, so they are not fake browser chrome.
- The character preview is interactive and displays selected skins; WebGL has a purpose here.
- News rotation has pause, previous/next controls, and hover/focus pausing.
- The CSS has visible keyboard-focus styles and a reduced-motion rule.
- Modal blur separates an overlay from its background; it is not an ornamental glass navbar.

## Validation and limits

All 30 unit tests passed. Production Vite build and Electron UI smoke test passed, including offline account persistence, skin closet, settings, instance creation, live Modrinth search, and the project version dialog.

Visually inspected Home, instance management, and Modrinth at 1420×900. Inspected Accounts, Settings, and Mods at the supported minimum 1000×680; these three views had no document-level horizontal overflow. Long pages scroll vertically. Screenshots are in `.test-output/` and are not committed. Network images were still loading in the captured Modrinth view, so image completeness was not scored. Mobile widths were not tested: `electron/main.cjs:243` enforces a 1000×680 desktop minimum.

unslop-ui scanned three source files. Before editing: score 5, three findings (two medium, one low). After editing: score 4, two medium findings (font and glow), zero high findings. This is a heuristic result, not an accessibility or visual-quality certification. No full 58-gate Hallmark pass is claimed.

Hallmark reviewer self-assessment, 1–5: Philosophy 4, Hierarchy 4, Execution 4, Specificity 5, Restraint 5, Variety 4. These describe this review, not automated measurements of the application.

Remaining UI findings: **1 critical · 2 major · 1 minor**.

Priorities: fix text contrast, choose a reproducible font setup, and stop filter labels wrapping.
