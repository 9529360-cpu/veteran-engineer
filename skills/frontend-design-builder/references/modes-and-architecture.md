# Delivery Modes and Technology Architecture

Use this reference when the task requires implementation decisions, production hardening, or non-standard frontend technologies.

## Delivery mode

Classify the task as one of these modes, inferring from context when obvious.

### Prototype mode

Optimize for validating the visual/product idea quickly.
- Favor fast, legible implementation over abstraction.
- Keep structure flat when that speeds iteration.
- Hardcoded values and inline styles are acceptable when they do not obstruct the concept.
- Skip non-essential performance tuning.
- Still preserve accessibility basics and responsive sanity.
- Clearly distinguish prototype shortcuts from production recommendations.

### Production mode

Optimize for maintainability, scalability, performance, accessibility, and design-system fidelity.
- Establish or discover tokens before repeated UI implementation.
- Use focused components and explicit variants.
- Avoid magic numbers when a system value exists.
- Use semantic HTML and keyboard/focus support.
- Optimize image loading and large assets appropriately.
- Prefer GPU-friendly motion based on transform/opacity.
- Keep comments focused on non-obvious intent, contracts, or constraints rather than narrating every line.

## Web architecture defaults

Follow the existing repo first. For greenfield work, choose architecture proportionate to the task.

### Vanilla HTML/CSS/SCSS/JS
- Separate tokens, base styles, components, and layout when the project is larger than a one-off page.
- Keep component selectors scoped and nesting shallow.
- Prefer modern module systems and CSS custom properties for runtime theming.
- Use rem/em for typography and scalable spacing where appropriate.
- Use Grid/Flexbox for layout instead of floats or absolute positioning hacks.
- Avoid animating layout properties when transform/opacity can express the same motion.

### React / Vite / Next.js
- Keep app-shell composition separate from feature modules and reusable primitives.
- Keep data/state helpers separate from visual components when complexity warrants it.
- Do not turn the root App/page component into a monolithic screen.
- Follow the repo's routing, server/client boundary, styling, data-fetching, and accessibility conventions.

### Angular
- Prefer component-scoped styles and explicit shared token layers.
- Use Angular CDK for overlays, drag-drop, focus management, and virtualized UI where appropriate.
- Use optimized image primitives and efficient change detection patterns supported by the installed Angular version.
- Keep animation definitions modular when motion is substantial.

### .NET MAUI
- Centralize colors, type, sizes, and styles in ResourceDictionary-based theme resources.
- Prefer reusable Styles and ControlTemplates over repeated inline attributes.
- Use idiom/platform triggers and adaptive layouts rather than fixed pixel positioning.

### Unity UI
- Separate major UI layers/canvases and avoid unnecessary rebuild churn.
- Prefer reusable/poolable panels for frequently shown/hidden UI.
- Anchor relative to parents; avoid hardcoded screen coordinates.
- Prefer TextMeshPro for production text and platform-appropriate event handling.
- For UI Toolkit, keep UXML structure and USS styling separated and bind shared tokens through custom properties.

### Godot
- Use Control/container layouts and anchors for responsive composition.
- Centralize theme resources so fonts, colors, constants, and style boxes inherit consistently.
- Use reusable scenes for HUD elements, dialogs, menus, and toasts.
- Use Tween/AnimationPlayer for UI motion; reserve shaders for effects that justify them.

### Unreal Engine UMG
- Use reusable UserWidget classes and shared base behavior for common open/close patterns.
- Use data-driven style resources or shared style sets for tokens.
- Prefer event-driven updates over per-frame polling for ordinary UI state.
- Use UMG animation tracks or programmatic widget animation where appropriate.

## Responsive strategy

Determine whether the product should be mobile-first, desktop-first, or adaptive from the product context. Do not blindly force one convention.

Define breakpoint behavior for:
- navigation and app shell;
- type scale;
- dense tables/editors;
- media and hero composition;
- dialogs/drawers;
- touch target sizing;
- content order and hierarchy.

Do not treat responsive work as shrinking desktop UI. Recompose when the hierarchy requires it.
