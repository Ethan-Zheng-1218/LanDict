# Desktop polish and reading repair implementation plan

> Execute the user-approved changes in this chat, then review the combined diff.

**Goal:** Deliver an installer with a transparent desktop icon, simpler translation labels, an optional automatic AI switch, and working installed news/article requests.

**Architecture:** Reuse existing settings persistence and the AI panel. Keep browser development proxies and give installed reading requests a native HTTP transport. Generate application icon formats from the existing transparent artwork.

**Tech stack:** React, existing UI controls, Tauri 2, Rust reqwest, application icon tooling.

**Spec:** User-confirmed requirements in this chat (2026-10-13).

## Constraints
- Keep manual AI behavior when the new switch is off; default it to off.
- Preserve source configuration, article extraction, audio and single-instance behavior.
- Preserve the blue icon and white book; only the outside canvas becomes transparent.
- Local Git commits only. Do not push. Deliver a clickable absolute installer path and an identical desktop copy.
- Do not touch unrelated untracked installer, icon or setup files.

## Tasks
- [x] Simplify translation labels and remove card subtitles; persist AI automatic mode and react to settings changes. Test manual/default mode, automatic word/text mode, query changes and cancellation.
- [x] Route installed reading requests through native HTTP; retain developer proxies. Test feeds, article bodies, allowed sources and unsupported URLs; check live requests separately.
- [x] Regenerate existing application icon formats using transparent artwork; inspect alpha around the exterior and preserve book pixels.
- [x] Review changes, run related and full frontend tests, Rust tests and production build.
- [x] Build the Windows installer, retain the single-instance smoke check, copy the installer to the desktop and verify the copy.

## Execution notes
- Reading root cause: browser-style `/api/reading-source` and BBC proxy paths are requested in the installed app, but those handlers exist only in Vite middleware.
- Use the existing `query.aiEnabled` field for the new explicit preference. New installations remain off; existing saved preferences are respected.
- Review corrections: AI uses the current query kind, preventing an intermediate request with the previous kind; native HTTP accepts Aeon's official `/feed.rss` redirect as a feed.
- Validation: 436 frontend tests passed; 23 Rust tests passed. The two opt-in live tests were run separately: BBC, CGTN, Quanta and Aeon RSS plus article HTML returned HTTP 200.
- Icon verification: all seven Windows ICO sizes have alpha=0 at exterior corners and retain opaque white book pages.
- The single-instance implementation and its smoke script are retained. The existing installed application was left running rather than terminated for another window test.
