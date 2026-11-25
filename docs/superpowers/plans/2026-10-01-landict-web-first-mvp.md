# LanDict Web-First MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a browser-previewable LanDict interface with a polished dictionary home, local demo lookup, word details, and browser-local wordbook interactions before any real API or Windows packaging work.

**Architecture:** Use the existing root Vite + React application in `src/` as the single UI source shared later with Tauri. Keep page composition, demo data, and browser state separated so real providers can replace demo implementations without rewriting the UI.

**Tech Stack:** React 19, TypeScript, Vite, React Router, Vitest, Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-01-landict-web-first-design.md`

## Global Constraints

- The root Vite + React app is the primary web preview; the legacy `web/` Next.js directory is not extended.
- No real external API, database, API key, login, or Windows packaging in this phase.
- UI copy remains primarily Chinese with English learning content where appropriate.
- New behavior follows test-first development and is verified with the full test suite.
- Each completed task ends with a focused Git commit.

## Review Focus

- Empty or whitespace-only searches show a helpful state and do not navigate to a broken detail page.
- Unknown words show a clear not-found state rather than fabricated details.
- Returning to the wordbook preserves saved words during the browser session.
- Navigation marks the active section and works on direct route loads.
- The interface remains usable at narrower browser widths without horizontal overflow.

---

### Task 1: Make the browser preview baseline reliable

**Files:**
- Modify: `package.json` if the root scripts need small corrections
- Modify: `src/app/AppFrame.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/styles/app.css`
- Test: `src/app/AppFrame.test.tsx`
- Test: `src/features/home/HomePage.test.tsx`

**Interfaces:**
- Consumes: existing React Router app and root Vite scripts.
- Produces: a stable shared shell with named routes for dictionary, reading, wordbook, review, history, and settings.

- [ ] **Step 1: Write or update failing shell tests** for navigation labels, active route state, and direct route rendering.
- [ ] **Step 2: Run the focused tests** and confirm failures describe missing or incorrect browser-preview behavior.
- [ ] **Step 3: Implement the minimal shell and route behavior** without adding business logic.
- [ ] **Step 4: Run the focused tests, then the full test suite.**
- [ ] **Step 5: Commit** with `feat: establish web preview shell`.

### Task 2: Build the dictionary home and demo lookup flow

**Files:**
- Create: `src/features/dictionary/dictionaryData.ts`
- Create: `src/features/dictionary/DictionaryHomePage.tsx`
- Create: `src/features/dictionary/WordDetailPage.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/app/AppFrame.tsx`
- Modify: `src/styles/app.css`
- Test: `src/features/dictionary/DictionaryHomePage.test.tsx`
- Test: `src/features/dictionary/WordDetailPage.test.tsx`

**Interfaces:**
- Consumes: route shell from Task 1.
- Produces: local `lookupDemo(query: string)` data behavior and routes for `/` and `/dictionary/:word`.

- [ ] **Step 1: Write failing tests** for known word lookup, sentence/paragraph translation placeholder, empty search, and unknown word state.
- [ ] **Step 2: Run the dictionary tests** and verify the expected red failures.
- [ ] **Step 3: Implement local demo data and the two dictionary pages** with accessible form labels and clear states.
- [ ] **Step 4: Run focused and full tests.**
- [ ] **Step 5: Start the Vite dev server and manually inspect the browser layout.**
- [ ] **Step 6: Commit** with `feat: add dictionary web preview`.

### Task 3: Add local wordbook interaction

**Files:**
- Create: `src/features/wordbook/wordbookStore.ts`
- Create: `src/features/wordbook/WordbookPage.tsx`
- Modify: `src/features/dictionary/WordDetailPage.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/styles/app.css`
- Test: `src/features/wordbook/WordbookPage.test.tsx`
- Test: `src/features/dictionary/WordDetailPage.test.tsx`

**Interfaces:**
- Consumes: word detail data from Task 2.
- Produces: browser-local wordbook state with `addWord`, `removeWord`, and `isSaved` behavior.

- [ ] **Step 1: Write failing tests** for saving, removing, empty wordbook state, and saved state visible on word detail.
- [ ] **Step 2: Run the tests** and confirm the expected failures.
- [ ] **Step 3: Implement the smallest browser-local store and wordbook page.**
- [ ] **Step 4: Run the full test suite and manually exercise the flow in the browser.**
- [ ] **Step 5: Commit** with `feat: add local wordbook flow`.

### Task 4: Add reviewable placeholder modules and preview instructions

**Files:**
- Create or modify: `src/features/reading/ReadingPage.tsx`
- Create or modify: `src/features/review/ReviewPage.tsx`
- Create or modify: `src/features/history/HistoryPage.tsx`
- Create or modify: `src/features/settings/SettingsPage.tsx`
- Modify: `src/styles/app.css`
- Modify: `README.md`
- Test: corresponding page tests under `src/features/`

**Interfaces:**
- Consumes: shared shell and visual language from Tasks 1–3.
- Produces: navigable, honest placeholder screens that clearly distinguish planned features from implemented demo behavior.

- [ ] **Step 1: Write failing tests** for each module’s title, empty/placeholder content, and route navigation.
- [ ] **Step 2: Run the tests and verify failures.**
- [ ] **Step 3: Implement the placeholder pages and beginner-friendly startup instructions.**
- [ ] **Step 4: Run the full suite and verify the production build.**
- [ ] **Step 5: Commit** with `feat: complete web-first module preview`.

### Task 5: Browser review checkpoint

- [ ] **Step 1:** Start the development server from the project root.
- [ ] **Step 2:** Review each route in the browser at desktop and narrow widths.
- [ ] **Step 3:** Record any UI changes requested by the user as a new small task rather than mixing them into unrelated work.
- [ ] **Step 4:** Commit only after the user accepts the current visual checkpoint.

