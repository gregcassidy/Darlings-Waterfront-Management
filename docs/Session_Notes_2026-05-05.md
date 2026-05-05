# Session Notes - 2026-05-05

## Summary
Shipped three substantial features: concert cancel/uncancel, three-state submission mode (`open`/`limited`/`closed`) with new-employee grace + per-user override, and the All-Submissions spreadsheet view with sort/filter/global search and per-row Entra-sourced location. Plus a Club check-in print sheet, per-slot attendance toggles, and the wiring to surface employee `companyName` from Microsoft Graph as the dealership location.

## Changes Made
### Feature 1 — Cancel/Uncancel a concert
- Soft-cancel sets `status: 'cancelled'` on the concert, hard-deletes its assignments, keeps preferences intact so admin can still see who had it ranked
- New endpoints: `POST /concerts/{id}/cancel` and `POST /concerts/{id}/uncancel`
- Admin list shows red **Cancel** on active concerts and amber **Uncancel** on cancelled ones; cancelled rows dimmed with badge
- Employee picker (`index.html`/`submit.html`) hides cancelled concerts; existing rankings show strike-through + `CANCELLED — pick a replacement` notice

### Feature 2 — Three-state submission mode
- Settings: `submissionsOpen` boolean → `submissionsStatus` enum (`open`/`limited`/`closed`); legacy key still read as fallback
- Admin Settings tab: three buttons (Open / Limited / Closed) with help blurb and live status badge
- Auto-flip: adding or cancelling a concert while `closed` flips status to `limited` automatically
- New-employee grace: `WF-Employees.createdAt < 21 days` → user always sees `open` mode
- Per-user override: new `canEditFreely` boolean on `WF-Employees`; admin sets via `PUT /employees/{userId}`
- Limited-mode rules (server-validated): at most 1 added and 1 removed concert; no reordering; removed concert must not have happened or be assigned; added concert must exist and not be cancelled
- Employee UI: ▲▼ disabled in limited mode; ✕ leaves a gap (no compaction); picker disabled when no gap exists; submit button gated on diff + no-gap

### Feature 3 — All Submissions spreadsheet
- New `GET /admin/all-submissions` endpoint: server-side join of preferences + employees + assignments + concerts (per-cell `assigned`/`attended` flags)
- New "All Submissions" tab in admin
- Columns: Last Name · First Name · Location · Type · Choice 1–5 · Override
- Every column sortable by header click; per-column text/select filters; **Choice columns have stacked text + color filter** (All / 🟩 Attended / 🟨 Assigned / ⬜ No tickets / ▢ Empty rank)
- **Global search box** matches across name, location, all five choice names
- Cell highlighting: yellow = assigned, green = attended (overrides yellow); cancelled concerts struck-through; assignment shown as small badge (`Club #12` etc.)
- Override toggle column: clickable green/empty checkbox per row, optimistic update via `PUT /employees/{userId}`
- Location cell: editable dropdown (14 dealerships) + preserves any existing Entra value as a custom option

### Supporting changes shipped along the way
- **Print check-in sheet** — Club Tickets header now has 🖨 button that opens a print-optimized HTML page (concert, date, table of `[☐ | Slot | Name | Phone | Signature]`) and auto-fires the print dialog
- **Per-slot attendance toggles** — every assigned slot in every section gains a ✓/○ button beside ✕; uses `PUT /assignments/{id}` with `{ attended }` and updates optimistically so admins can rapidly check off many people
- **Microsoft Graph `companyName` → location** — `auth.js` Graph fetch now requests `companyName`; backend `submitPreferences` and `updateMyProfile` map it to `WF-Employees.location`; `admin.js` init now also runs Graph profile sync (was previously only `app.js`, so admins never got their record updated)
- **`getAllEmployees` no longer filters out admins** — the request/slot enrichment maps were missing admin records, so admins (most of the team) showed no jobTitle/location on concert detail
- **All concert-detail employee detail strings now use `profile.location`** instead of the junk `profile.officeLocation` extension number (Requests list, slot grids, assign modal dropdown)
- **`btn-amber` CSS variant** added for the Limited mode button + Uncancel button

## Files Modified
- `infrastructure/lambda/functions/concerts/index.js` — `cancelConcert`, `uncancelConcert`, `autoFlipToLimitedIfClosed` helper, `ASSIGNMENTS_TABLE` env
- `infrastructure/lambda/functions/preferences/index.js` — three-state mode helpers, `validateLimitedSwap`, `getAllSubmissions`, `adminUpdateEmployee` (canEditFreely + location), `companyName` mapping, removed admin filter from `getAllEmployees`, public-submission cancellation guard
- `infrastructure/lambda/functions/settings/index.js` — `submissionsStatus` allowed key + enum validation + backward-compat fallback in GET
- `infrastructure/lib/api-stack.ts` — new routes (`/concerts/{id}/cancel`, `/concerts/{id}/uncancel`, `/employees/{userId}` PUT, `/admin/all-submissions`); granted assignments table to concerts + preferences functions
- `public/admin.html` — All Submissions tab markup with toolbar/search/table; three-state Settings UI; help blurb
- `public/js/admin.js` — concert table cancel/uncancel buttons; attendance toggle on slots; check-in print sheet; All Submissions module (state, sort, filter, search, render, override toggle, location dropdown); Graph profile sync on init; `profile.location` everywhere on concert detail
- `public/js/app.js` — three-state mode banner, `computeEffectiveMode`, no-compaction in limited mode, mode-aware picker/disable logic, swap-diff submit gating, cancelled-concert badge in slots
- `public/js/auth.js` — added `companyName` to Graph `$select`
- `public/index.html` — banner element repurposed for mode messaging (no markup change required)
- `public/submit.html` — filter cancelled concerts from public picker; minor wording tweaks
- `public/css/styles.css` — `.btn-amber`, full `.submissions-table` ruleset (sticky headers, color highlights, override toggle, filter row stacking)
- `CLAUDE.md` — Settings table description + "Open/close submissions" task updated for three-state mode

## Current Status
- All three planned features are live in production at `https://waterfront.darlings.com` (and the legacy CloudFront URL)
- Print check-in sheet, per-slot attendance toggles, and uncancel are live
- Admin spreadsheet is functional; sort, filter, global search, color filter, location dropdown, and override toggle all work
- Greg's location populates from Entra `companyName` on admin login
- Kim Cotta's `WaterfrontAdmin` Entra role was removed; her cached `isAdmin: true` in DDB will self-correct on her next login

## Next Steps
- [ ] **Verify limited-mode UX with a real non-admin account** (Greg's testing was bypassed by admin role + new-employee grace; documented but never end-to-end verified by a regular employee)
- [ ] **Decide whether to remove the backend admin bypass for `submitPreferences`** — admins currently always get `'open'` mode for their own prefs, which prevents in-place testing. Cleaner design: admins follow the same rules; use `canEditFreely` to override themselves.
- [ ] **Audit remaining open items from prior sessions:**
  - [ ] Add `https://waterfront.darlings.com/{index,admin,login}.html` as redirect URIs in the Entra app registration; remove old CloudFront URLs after confirmation
  - [ ] Verify SES sender email (`notificationFromEmail`) so notification Lambdas can actually send
  - [ ] Decide email-export dedupe behavior when one person appears in multiple sections of the same concert
  - [ ] Consider retiring the `d2ih87vneh642g.cloudfront.net` URL once internal users are using the custom domain
- [ ] Optional cleanup: clear Kim Cotta's stale `isAdmin: true` cache in DynamoDB (she'll self-heal on next login otherwise)
- [ ] Optional: surface admin-only edit hints on the spreadsheet (e.g., shift-click multi-select for bulk override; CSV export of the whole grid)

## Notes
- **Soft-cancel design choice:** concert is marked `status: 'cancelled'` (preserves history + prefs for admin visibility) but assignments are hard-deleted. Uncancel restores the concert but does NOT recover assignments — admin must re-assign. Greg confirmed this trade-off was acceptable.
- **Limited-mode swap rule:** "at most 1 added and 1 removed" allows: do-nothing, single add, single remove, or 1-for-1 swap. Reorders are explicitly disallowed (frontend disables ▲▼; backend rejects).
- **Auto-flip trigger:** both adding and cancelling a concert auto-flip `closed` → `limited`; not triggered when status is already `open` or `limited`. Other settings changes don't auto-flip.
- **Entra companyName as source of truth for location:** the Microsoft Graph `officeLocation` field at Darling's contains numeric extension numbers (1719, 1725, etc.) — not the dealership. `companyName` is what HR populates with the dealership name. The admin spreadsheet dropdown can override per-row but Graph sync runs on every login, so manual overrides will be re-overwritten on the next sync (acceptable per the lightweight approach we chose).
- **`getAllEmployees` admin filter was a latent bug:** the original `.filter(e => !e.isAdmin)` was probably intended to keep "managers out of the employee list," but in practice 3 of 4 employees at Darling's are admins. The filter caused admin rows to render without job title or location on concert detail. Removed.
- **Memory updated:** `~/.claude/projects/-workspaces-Darlings-Waterfront-Management/memory/feature_3_override_toggle.md` now also documents the yellow/green highlight rules; the override toggle requirement was satisfied this session.
