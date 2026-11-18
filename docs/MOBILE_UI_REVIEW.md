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
