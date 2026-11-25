# CDB project rules

- Keep exactly one `data-codex-root` that covers the complete target page.
- Keep every existing `data-codex-id` stable and unique; add semantic IDs to new editable elements.
- Keep project assets under `assets/` and use relative, project-local URLs.
- SVG must not contain scripts, event handlers, external resources, or embedded remote images.
- Keep important editable elements in the initial HTML. Do not replace mapped nodes with random runtime DOM.
- Do not silently rewrite dynamic business logic or remove content to make capture pass.
