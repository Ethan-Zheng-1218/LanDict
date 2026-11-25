# Unified lookup and AI learning implementation plan

> Execute using subagent-driven-development with independent file ownership and final code review.

**Goal:** Unify English word interactions and add the approved five AI learning tabs to the query page.
**Architecture:** Retain the dictionary/local/AI separation. Prefer public Youdao dictionary for words and supported phrases, keep local sentence translation as explicitly chosen by the user. Reuse LookupText for all rendered English text. AI learning requests are lazy and individually cached/cancellable.
**Tech stack:** React, Base UI buttons, TypeScript/Vitest, Tauri/Rust.
**Spec:** User-approved design-previews/ai-learning-reading.html and conversation decisions, including derivative rules.

## Constraints
- Exactly five learning categories: examples, roots, synonyms, antonyms, derivatives.
- Derived words must have different spellings and a genuine derivational relationship; exclude mere inflections and same-spelling changes such as water noun/verb. Do not invent entries to fill a quota.
- English words in dictionary, local translation, AI translation and learning results must navigate to the same query route; selecting text must not trigger navigation.
- Whole sentences remain local translation + optional AI; no new Youdao credentials or invented provider labels.
- Existing themes and manual/automatic AI settings remain effective. No installation build requested this turn.

## Tasks
- [x] Add tests and implement online-first lookup for English phrases and longer Chinese terms, preserving local fallback and text classification.
- [x] Add typed AI learning request category and structured, numbered learning prompts. Include category in cache keys; cancellation must not populate cache.
- [x] Integrate approved reading-style tabs into OptionalAiPanel for English word queries; translate phrases/sentences normally and guide users to click an English target for word-specific learning.
- [x] Make AI and non-dictionary translation text clickable with LookupText; propagate lookup navigation to reader AI cards as applicable.
- [x] Test stale requests, category caching/retry, copy, selection safety, Chinese/English routing, and all theme layouts. Run complete frontend suite, TypeScript and Rust checks where native query code changes.
- [x] Complete independent review, update this checklist, and commit locally without push.

## Review focus
- Chinese three-character terms versus full Chinese sentences.
- Phrase dictionary matches must not create incorrect saved word or pronunciation requests.
- Category switching and query changes cannot show stale AI results.
- Word learning is not applied to an entire sentence or an unspecified Chinese target.
- AI responses are text, never executable HTML; missing semantic relationships must be stated accurately.

## Verification and review
- Frontend: 572 passed, 2 skipped; TypeScript check passed.
- Native: 25 passed, 2 live-network tests ignored.
- Independent code review: no substantiated defects; unused reader panel functions were excluded from scope.
- Browser checks passed three consecutive runs: five categories, cache reuse, text-selection safety, word navigation, three themes and 820px viewport.
- Browser AI/dictionary responses used synthetic fixtures with a dummy key; real provider protocol/prompt/cancellation behavior is covered by provider and integration tests. No paid AI request was made for visual checking.
- Visual evidence: C:/Users/Ethan/.codex/visualizations/2026/11/09/01a1bf23-e692-7180-9845-f7d605c9aad9/ai-learning-{blue,lime,black,derivatives,compact}.png.
- No installer generated. Existing 0.1.5 version retained for this source-only change.
