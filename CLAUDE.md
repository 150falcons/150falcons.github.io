# 150 Sqn Trainee Movement Board: brief for Claude Code

You're picking up a working web app. Read this whole brief before changing anything.

## 1. What it is
A book-in / book-out board for RSAF trainees at 150 Squadron (BA 120 Cazaux, France). Trainees sign in and book out when they leave base, report back in, and the squadron gets Telegram updates. Owner/admin: Gordon Lee (callsign **Brut**, login `brut`), a QFI at the squadron. He isn't a developer, so explain changes in plain language and keep answers concise.

## 2. Architecture
- **Front end:** one file, `index.html` (vanilla JS, no build step). It uses `@supabase/supabase-js@2.45.4` from jsdelivr, plus Google Fonts (Barlow Condensed, IBM Plex Sans). It supports light and dark mode and is mobile-first.
- **Back end:** Supabase project **`ighnqntkupzqisstzmpy`** (https://ighnqntkupzqisstzmpy.supabase.co). The anon key is in `index.html`. That's fine because it's public by design and row-level security (RLS) protects the data. **Never put the service_role key in the page.** Signed-out (anon) users can read nothing (all table policies are `authenticated`), and EXECUTE on every SECURITY DEFINER function is revoked from `anon`/`public` (7 Oct). Grant new RPCs to `authenticated` only.
- **Hosting:**
  - **Live:** GitHub Pages, repo `150falcons/150falcons.github.io` (a free GitHub organization owned by gordonlee91; formerly `gordonlee91/150movementboard`), serving `https://150falcons.github.io/`. Pages source is branch `main`, folder `/ (root)`, with an empty `.nojekyll` and no custom domain. To publish a change, commit `index.html` and push to `main`; it's live in about a minute.
  - **Old host:** Netlify (`https://150traineemovement.netlify.app`, site id `d4661650-7072-4127-8f88-22cb40b89323`). Its free deploy credits ran out on 6 Oct 2026, so it's frozen on an older version.
- **Telegram:** a Postgres function `tg_send(msg)` posts to the bot using `pg_net`. The bot token and chat id are in Supabase Vault (`telegram_bot_token`, `telegram_chat_id`). Messages use HTML parse mode.
- **Nightly check:** pg_cron job `nightly-movement-check` runs at `40 19-22 * * *` UTC, calling `nightly_check(false)`. The function itself only sends at **2140L Sun–Thu** and **2340L Fri–Sat** (Europe/Paris), so this one schedule works across summer and winter time.

## 2b. Name and navigation (7 Oct 2026)
- **Name:** the site is **150 Falcon Det** (page title and top bar). Tapping the name goes to the home screen.
- **Home** (after sign-in): two cards, **Trainee movement** (in base / out / on leave / overdue, pending approvals) and **Operations** (today's sorties and first takeoff).
- **Top bar areas:** Movement · Operations · Admin (Roster for trainees). Sub-tabs: Movement → Board / Log / Vehicles; Operations → Flying program. The movement counts strip only shows inside Movement. Ops assistants open on Operations.
- **Code:** `AREA` (tab → area) and `SUBTABS` (area → pages) in `index.html`; tabs are `home`, `board`, `log`, `vehicles`, `ops`, `roster`.

## 3. Business rules (agreed with Gordon)
- **Accounts:**
  - **No emails.** Usernames are stored in Supabase Auth as `<username>@150sqn.local`, and the page adds or strips that suffix.
  - **Two roles:** admin (instructor) and user (trainee).
  - **First sign-in:** a trainee must replace the temporary password before using the board.
- **France only (added 7 Oct, Gordon's request):** after a successful sign-in (and each time a signed-in user opens the page), it asks for location and only shows the board inside metropolitan France (box: lat 41.3–51.15, lng −5.2–9.6, so it spills slightly into neighbours). Denied → "Location needed"; outside → "You are not in France"; both have Try again and Sign out. Applies to everyone, including instructors and trainees on leave abroad. It's a browser-side check (keeps casual outsiders out, can be faked); the real protection is accounts + RLS.
- **Instructor appointments:** CO, DYCO, OC A, OC B and CC each have a single holder; QFI can have many.
  - **Who can approve travel requests:** CO, DYCO, OC A and OC B. CC and QFI cannot.
  - **No approvers yet:** if nobody holds an approving appointment, any admin can approve.
  - **Acting OC:** was built and then removed at Gordon's request. Don't re-add it.
- **Trainees:**
  - **Fields:** name, course, phone, `can_drive`.
  - **Courses:** e.g. 200/203/204/206 FWC, 29/30 WSO, PGF. The board groups people by course: FWC first, then WSO, then others, numbers ascending.
  - **Posting:** "Post in" creates the trainee and their login. "Post out" deactivates both but keeps their history.
- **Booking out:**
  - **When:** choose **During office hours** (creates a *travel request* that needs approval) or **After office hours** (books out immediately, for info).
  - **Transport:** Car / Public transport (tick Bus, Train or both) / Other (taxi, Uber, lift, walk).
  - **Car rules:**
    - **Driver:** must have `can_drive`.
    - **VCOM:** required, except trips to **Cazaux**, which can drive alone.
    - **Seats:** max people = the car's `seats` (2–9, default 5).
  - **Public transport / Other:** tick who's going; going alone is allowed but warned against.
  - **One Book out button:** full width at the top of the Board (the search box and the per-row Book out buttons were removed at Gordon's request, 7 Oct). For a trainee, the form starts with them locked into the trip.
  - **Trainees booking themselves:** a non-admin must be on the trip.
  - **Not allowed:** booking out someone who is already out, has a pending request, or is on leave.
- **Back in base is per person:** each person is marked Back in base, On leave (with a return date) or Still out.
  - **Partial returns:** the trip stays open for anyone still out.
  - **No solo driving:** the board refuses anything that would leave one person alone in a car on a non-Cazaux trip.
- **On leave** (e.g. dropped at the airport during base closure): a separate board section with a return date. The person can't be booked out until "Back from leave", and the nightly check lists them separately.
- **Rearrange for return:** one screen to move people between open trips and set roles, applied atomically on Confirm.
  - **Validation:** each car has one driver who can drive, at most one VCOM, a VCOM unless it's a Cazaux trip, and no more people than seats.
  - **Empty trips:** close.
- **Vehicles:** course or personal cars, with description, plate (unique) and seats. Admins can edit; trainees can add and remove their own.
- **Phone numbers:** optional. Shown as tap-to-call on out-of-base strips, Roster and Admin; editable by admins under Edit.

## 3b. Ops board (added 7 Oct 2026)
- **What:** Operations → **Flying program** replaces the daily Excel flying programme (the sheet is marked RESTRICTED; Gordon confirmed it may be put on the board). Code is in `ops.js` (loaded before the main script with a `?v=` cache-buster: bump it on every change) and uses the main script's helpers.
- **Data:** table `ops_sections` (day, section, data jsonb, version, updated_at/by), one row per day per section: `header`, `flying` (waves → flights → aircraft lines; each wave has its own SXO, OPS O and remarks), `sim`, `ground` (named groups), `airfield` (+ sunset), `notes` (currencies, aircraft restrictions), `duties` (named groups of people; QFI group has in/out times).
- **Who:** everyone signed in can view (RLS). Editing is via `ops_save(day, section, data, version)`, allowed for `can_edit_ops()`: CO, DYCO, OC A, OC B, plus any profile with `profiles.ops_editor` (ticked per instructor under Admin → Edit, and the ops assistant account). `ops_save` refuses if someone else saved that section in between (optimistic `version`). `set_ops_editor(user, on)` is admin only.
- **Ops assistant account:** a `role = 'user'` login with no trainee and `ops_editor = true`, made under Admin → Ops assistants. It opens on the Ops tab and can't book movements.
- **Worked out, not typed:** planned sorties / hours (non-"ops add" aircraft lines × ETD–ETA), first takeoff, last landing, HH:MM; duty-table cells get `#` / `(#)` / `SIMS` / `SXO` / `OPS O` automatically from the programme (sims are placed in the wave whose time window they fall in); editors only type extras (LATE IN, ACAD…). QFI rest = today's in − yesterday's out (from yesterday's duties), duty = out − in.
- **Other features:** day picker, Copy from another day (duty notes and in/out times aren't copied), "Your day" card for the signed-in person, live updates via realtime, PDF = browser print of a sheet-style layout with RESTRICTED top and bottom.

## 4. Telegram message formats (Gordon specified these, keep them)
- **Car book-out:**
  ```
  🚗 Booked out
  Location: Biscarrosse
  ETD: 1423L
  ETA: 2000L
  Vehicle: 206 mini, AB-123-CD
  Driver: Cheong G
  Vcomm: Lee J
  Passengers: Kok J / Nil
  ```
- **Public transport / Other:** 🚌 / 🚆 / 🚌🚆 / 🚶 "Booked out", then Location, ETD, ETA, `Transport: Bus + Train (TER 1412)` and `Personnel: … (alone)`.
- **Travel request:**
  ```
  📝 TRAINEE TRAVEL REQUEST
  During or After Office: During
  Name of Personnel: Tok J (Driver), Lee L (Vcomm)
  Destination / Purpose / Date & ETD: 0942L 05/10/2026 / Date & ETA / Transportation plan
  ⏳ Pending approval
  ```
  Then reposted with ✅ Approved by OC 'B' / ❌ Not approved by … (+ Reason) / ↩️ Withdrawn by ….
- **Other messages:** ✅ Back in base (Back: / 🏖️ On leave until … / Still out:), ⏱️ Return time changed, 🏠 Back from leave, 🔄 Rearranged for the return.
- **Times:** shown as `HHMML`, with the date added if it isn't today (`fmt_l`). Emojis stay as they are.

## 5. Database (public schema)
- **Tables:**
  - **`trainees`:** id, name, course, phone, active, posted_out_at, can_drive.
  - **`profiles`:** id = auth user, email (`user@150sqn.local`), display_name, role admin|user, trainee_id, must_change_password, appointment (CO|DYCO|OC A|OC B|CC|QFI), acting_oc/acting_for (unused).
  - **`vehicles`:** description, plate, plate_key (generated), owner_type course|personal, course, owner_trainee, added_by, seats.
  - **`movements`:** one row per trip.
    - **People:** `members` jsonb (current crew: id, name, course, role driver|vcom|pax|person) and `member_ids` uuid[] (current crew), plus `orig_members` (original crew, set by a trigger) and `events` jsonb (per-person in / leave / moved / joined).
    - **Status:** `status` is pending|out|in|rejected|withdrawn.
    - **Trip details:** transport (car|public|bus|train|other), vehicle_id, vehicle_label, destination, reason, expected_back, etd, office_hours.
    - **Approval:** decided_by, decided_at, decided_as, decision_note.
    - **Logging:** out_at, out_by, out_loc, in_at, in_by, in_loc.
  - **`leaves`:** trainee_id, until (date), movement_id, started_*, ended_*. Only one open leave per trainee.
- **Main functions (SECURITY DEFINER; the page calls them through RPC):**
  - **Booking:** `book_movement(p_transport, p_driver, p_vcom, p_pax, p_people, p_destination, p_vehicle_id, p_vehicle_other, p_details, p_reason, p_expected_back, p_loc, p_office, p_etd)` is what the page calls. Car bookings delegate to `book_out(...13 args)`. The 11-arg `book_out` is legacy and EXECUTE is revoked.
  - **Approvals:** `decide_request`, `withdraw_request`.
  - **Returns and leave:** `return_people(p_id, p_in[], p_leave[], p_until, p_loc)`, `end_leave(p_trainee)`, `change_time`.
  - **Rearranging:** `rearrange_trips(p_plan jsonb)`. `swap_person` is used by no screen now; `swap_car` is revoked.
  - **Admin:** `set_role(p_user, p_appointment, p_acting)` (p_acting is ignored), `clear_must_change`, `set_my_phone`, `nightly_check(p_force)`.
  - **Helpers:** `can_approve`, `approver_label`, `crew_lines`, `crew_text`, `tg_request`, `fmt_l`, `fmt_dt`, `names_of`, `car_seats`, `is_admin`, `my_trainee`, `who`.
- **Edge function `admin-users`** (verify_jwt on): actions create / update (rename username or display name; it also renames the linked trainee) / reset_password / ban / unban / delete. It checks the caller is an admin, then uses the service role.
- **Telegram approvals for OCs (added 7 Oct 2026):** OC A and OC B tap **Link Telegram** (Admin tab, Telegram card) to get each travel request privately from @Trainee_Movement_Bot with ✅ Approve / ❌ Reject buttons. Reject asks for an optional reason (type it, or tap "Reject without reason"). CO/DYCO are deliberately not included (Gordon's choice); they still approve on the board.
  - **Edge function `telegram-bot`** (verify_jwt off; checks the `telegram_webhook_secret` Vault secret on every call) is the bot's webhook and also handles internal calls from the trigger.
  - **Trigger `movements_tg_notify`** (`tg_movement_notify`): a new pending request DMs linked OCs; a request leaving pending (any route) edits their copies to show the outcome and removes the buttons.
  - **Decisions** go through `tg_decide_as(user, id, approve, note)`, which checks the user is OC A/B and then calls `decide_request` as that user, so the board's rules and group messages apply.
  - **Tables (RLS on, service role only):** `tg_links` (OC user → Telegram chat), `tg_link_codes` (one-time /start codes, 30 min), `tg_request_msgs` (DM message ids per request), `tg_await_reason` (OC is typing a reject reason).
  - **Board RPCs:** `tg_link_code()`, `tg_link_status()`.
  - **Group clean-up:** once a request is approved, rejected or withdrawn, the group's "⏳ Pending approval" post is deleted so only the outcome post stays (Gordon's request). `book_out`/`book_movement` send the pending post via `tg_send_pending(m)`, which records the pg_net request id in `tg_group_msgs`; cron job `tg-fill-group-msg-ids` (every 2 min) copies Telegram's message id in before pg_net's ~6 h response retention; the `decided` step in `telegram-bot` calls `deleteMessage`. Telegram only lets bots delete messages under 48 h old, so a request pending longer keeps its pending post.
- **Realtime:** trainees, profiles, vehicles, movements and leaves are in `supabase_realtime`, and the page re-fetches on any change.
- **Gotcha:** through the Supabase MCP, any statement containing `DROP` hung waiting for a confirmation that never came, and timed out. On 7 Oct a plain `DELETE` hung the same way. Earlier changes avoided it with `CREATE OR REPLACE`, new function names, or `pg_get_functiondef` + `replace` + `EXECUTE`. If you have the Supabase CLI or direct SQL access, normal migrations are fine.

## 6. Status (7 Oct 2026)
- **Done:** the latest `index.html` (solo-driving warnings, random `Falcon-xxxxxxxx` temporary passwords) and `.nojekyll` are on `main`, and Pages is deployed.
- **Still in trial:** trainees haven't been given logins yet. The test movements were cleared from the log.

## 7. Open items
- **Before rollout:** 15 of 20 accounts still have `must_change_password = true` and the original temporary password, which was visible in the old page's source. Reset them when handing out logins; Admin → Reset password generates a random password.
- **Leftover test data:** one ended row in `leaves`. It doesn't show anywhere; delete it from the Supabase Table Editor if wanted (the MCP delete hung).
- When Netlify credits reset, optionally replace the Netlify page with a "moved to …" notice.

## 8. How Gordon likes to work
- **Communication:** short, direct answers. Say what changed and how to try it. He tests on his phone, often in dark mode.
- **Testing:** test every change before publishing, and say honestly what was and wasn't tested.
- **Scope:** don't add features he didn't ask for without checking first.
