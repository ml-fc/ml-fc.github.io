# Mobile interface review — release 2026-11-18.94

Reviewed using Playwright with synthetic API fixtures. No real player records, votes or notifications were changed.

## Coverage

- Eleven route/state combinations at 320, 360, 390, 430, 768 and 1440 CSS pixels: admin list, user management, match management, home, scored match, upcoming match, leaderboard, my season, profile, captain/admin ratings, season awards.
- All 66 combinations rendered without JavaScript exceptions or horizontal page overflow. Editable phone/tablet form controls use at least 16px text.
- At 320 and 390 pixels: season management, awards desk, award configuration, nominee selection, theme settings, match creation, announcements, phone/email/password/status dialogs, player history and FC-card guide. Dialog contents fit their available widths.
- Additional checks: team-position editor, MOM voting field, stream settings, admin MOM participation, guest sign-in/reset/registration, privacy and terms pages, and the Cristiano/Liverpool theme treatments.
- The tactics editor was checked for a noncollapsed pitch with all twelve synthetic players visible. The long-name leaderboard player link was opened after moving award badges below the name.

## Changes

- Fixed the admin crash caused by binding the Awards button in the wrong template.
- Integrated the countdown and Awards shortcut into a compact season bar that follows the selected club theme.
- Kept the next match near the top of home; past-season honours remain expanded below match content.
- Corrected season-title contrast and the incomplete final row of honours cards.
- Increased small mobile input text and touch targets; made long names wrap; gave ratings/goals/assists player-specific accessible labels and numeric keyboards where appropriate.
- Fixed an optional-note grid-row mismatch that collapsed the tactics pitch.
- Aligned privacy/terms stylesheet versions with the PWA release.

These are browser viewport checks, not physical-device certification. Device permission prompts, push delivery and OS share sheets remain platform-controlled; their production side effects were not triggered during this review.

## Awards refinement — release 2026-11-18.95

- Replaced the large slogan/banner with a centred page heading and Back/Refresh controls. Verified header height of 69px on 320/390px phones and centred content at 768/1440px.
- Added Golden Boot, Most Assists, Highest Rated (10 rated matches), Most MOM and Most Appearances leaders in both the ballot page and admin dialog, using the existing Ladder API. Ties are displayed together. Final-season honours keep their existing completed-match rules.
- Verified previous-screen Back navigation and Home fallback after opening/reloading a direct ballot link.
- Checked tied leaders, rating qualification, empty statistics, and voting availability when the leaderboard request fails. Refresh recovers the statistics panel.
- Added an admin explanation that an OPEN season's end date automatically drives the Home countdown; there is no separate enable switch.

## Compact awards voting — 20 November 2026

- Replaced the long, fully expanded ballot with keyboard-accessible category sections. One category opens at a time; successful saves collapse the category and show a green tick, “Voted” label and saved player. Votes can still be updated before closing.
- Kept two nominee columns on phones, reduced names to 12px, used smaller portraits and removed repeated “Season nominee” captions. Full names wrap and nominee targets remain at least 58px high. Season leaders remain available in an expandable panel.
- Added saved-vote and eligible-pending counts to the ballot and Home Awards shortcut. Draft, closed and ineligible categories do not inflate pending counts. Home fetches fresh progress on return; failed requests retain a neutral link instead of showing invented counts.
- Added an admin “Share voting link” action. It fetches current open categories, prepares one message with each category's Melbourne closing date and the season ballot URL, and offers WhatsApp, native sharing where supported, and copy. Existing per-category participation image exports remain available.
- Preserved unsaved nominee choices and expanded sections during refresh, prevented duplicate submissions, guarded stale ballot responses, and restored focus after vote completion and closing the share dialog.

### Space measurements

Same synthetic fixture at 390×844: six open categories with 20 nominees each, one category already voted.

| Area | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| First category's nominee grid | 1,790px | 673px | 62% |
| Ballot list, initial view | 13,266px, all categories expanded | 1,616px, one category expanded | 88% |

These measure content height, not scroll distance or total effort to complete every vote.

### Validation

- `tests/awards-ballot.browser.js`: passed save, update without double-counting, duplicate-submit prevention, failed-save retry, self-vote restriction, ineligible/closed controls, keyboard categories, saved ticks, refresh selection/focus, long names, season leaders, actual Home → ballot → Back progress, all-voted/no-open states and read-error fallback.
- Responsive checks at 320, 360, 390, 430, 768 and 1280px: two nominee columns, no horizontal page overflow and at least 58px nominee targets. Default and a GOAT theme inspected.
- `tests/awards.browser.js`: passed fresh combined messages with different deadlines, closed-category exclusion, WhatsApp URL encoding, native/copy mocks, unsupported native sharing, stale/no-open/error handling, share-dialog focus, category add/remove, fresh participation, PNG content/download, privacy and existing Club Desk navigation.
- All frontend and browser-fixture JavaScript syntax checks and `git diff --check` passed. Confirmed matching build query strings and existing offline asset entries. Current shared-workspace build is `2026-11-20.102`.
- All backend requests were intercepted with synthetic fixtures. No real votes, notifications, WhatsApp messages or production data were written. Physical-device share sheets, real WhatsApp delivery and a full offline/service-worker upgrade cycle were not exercised. No deployment was performed.

### Review artifacts and files

Screenshots under ignored `output/playwright/`: `awards-ballot-before-390.png`, `awards-ballot-after-390.png`, `awards-overview-after-390.png`, `awards-home-progress-390.png`, `awards-theme-390.png`, and `awards-share-all-phone.png`. Test results are saved in `awards-ballot-results.txt` and `awards-admin-results.txt` in the same directory.

Awards implementation: `src/ui/awards.js`, `src/ui/season_honours.js`, and scoped additions in `styles.css`. Release references: `src/config.js` and `index.html`. Regression coverage: the new ballot fixture and the extended admin awards fixture. Unrelated theme edits in the shared workspace were preserved.
