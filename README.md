# IM2 PROJECT

# ALEK Consultants — Project Management & Billing System

A web app for **ALEK Consultants Inc.** that manages the full lifecycle of a
project: from a client's initial consultation request, through an
ALEK-authored proposal, client confirmation, execution, billing, and payment
collection.

## 1. User roles

| Role | Can do |
|---|---|
| **Client** | Request a consultation, confirm or decline project proposals, view their own projects and billing statements, upload proof of payment, view payment history |
| **Project Manager (PM)** | Handle incoming consultation requests, author project proposals after an offline assessment, create and manage projects once a proposal is confirmed, request billing statements |
| **Finance Admin** | Review/approve billing requests, issue billing statements, record payments, verify client-uploaded payment proofs, manage client records |

Roles are enforced at the database level via Supabase Row Level Security
(RLS) — a role can only see or modify the rows it's actually allowed to,
regardless of what the front end shows.

## 2. Core business process

The base process (client consultation request → PM assessment → proposal →
NOA/NTP → billing → payment) is unchanged from the original process design.
What was added is an **approval layer** in front of the two most sensitive
actions in the system: creating a Project, and issuing a Billing statement.
Previously either could be created directly by a single role with no review
step; the current system requires a request first, then a review, before the
real record is created.

The project-request workflow specifically mirrors the original Business
Process diagram: the client's only originating action is a bare
**consultation request**. Assessing the problem and preparing the proposal
(project type, scope, estimated budget) happens inside ALEK's lane, offline.
The client's next real touchpoint is *receiving* the proposal and confirming
it — this is the system's equivalent of Notice of Award (NOA) / Notice to
Proceed (NTP). So a **PM authors** the proposal after the offline
consultation, and the **client confirms or declines** it — not the other way
around.

## 3. The four workflows

### 3.1 Consultation request → PM contact

1. **Client** opens **Project Proposals** and sends a **Consultation
   Request** — just a message describing what they need. No project type or
   budget; that hasn't been assessed yet.
2. **PM** sees it in the Consultation Requests inbox and marks it
   **Contacted** once the offline consultation happens.
3. The consultation isn't a record that "becomes" anything by itself — it's
   context. The PM's actual next step is authoring a proposal (3.2), which
   can optionally link back to the consultation that triggered it.

### 3.2 Project proposal → client confirmation → project

1. **PM** opens **Project Proposals** and, after the offline consultation,
   clicks **New Project Proposal**: chooses the client, then fills in title,
   location, project type, description, estimated budget, and preferred
   start date. Status starts as `pending`.
2. **Client** sees it under their own **Project Proposals** and clicks
   **Review**, then **Confirm** or **Decline** with an optional note. This
   is the client's NOA/NTP moment.
3. Confirming does **not** create the project automatically — it opens the
   **Create Project** form pre-filled with the proposal's details (a
   `fromRequestNotice` banner shows which proposal it came from). The PM
   fills in the remaining fields (contract amount, dates, financial admin)
   and submits.
4. Only at that point does a row exist in the `projects` table, linked back
   to the original proposal via `converted_project_id`.

### 3.3 Billing request → approval → billing statement

1. **PM** opens **My Billing Requests** and submits a request against one
   of their projects: requested amount, billing type, description. Status
   starts as `pending`.
2. **Finance Admin** opens **Billing Requests**, reviews it, and clicks
   **Approve** or **Reject**.
3. Approving runs `approve_billing_request()`, which inserts the official
   row into the `billing` table and links it back to the request via
   `source_request_id`. This is the **only** path into the `billing` table
   — a PM can never write to it directly.
4. The statement now appears on **Billing Statements**, visible to the
   client it belongs to.

### 3.4 Payment → proof → verification

1. **Client** sees a billing statement's outstanding balance on
   **Billing Statements** and clicks **Upload Proof of Payment**, attaching
   the claimed amount and a receipt/screenshot.
2. **Finance Admin** reviews it on the **Payments** page, under the
   **Proofs** tab.
3. Verifying runs `verify_payment_proof()`, which inserts the real row into
   `payments` and updates the statement's `balance_left`. This — plus a
   Finance Admin manually recording a payment — are the **only** two paths
   into the `payments` table. A client can never write to it directly.

## 4. Screen-by-screen walkthrough

### As Client
| Screen | What happens |
|---|---|
| Dashboard | Own project count, balance, payment status |
| Project Proposals | Request a consultation, review and confirm/decline proposals PM sends, track status (`pending` → `confirmed`/`declined`) |
| Billing Statements | View statements, upload proof of payment |
| Payments | View own payment history (read-only) |

### As Project Manager
| Screen | What happens |
|---|---|
| Dashboard | Own assigned projects, proposals still awaiting client confirmation |
| Project Proposals | Handle the Consultation Requests inbox; author new proposals (optionally linked to a consultation); track confirmation status |
| Create Project | Pre-filled form after a client confirms a proposal |
| Project Portfolio | Manage own projects, update status/progress |
| My Billing Requests | Submit billing requests per project |

### As Finance Admin
| Screen | What happens |
|---|---|
| Dashboard | System-wide totals: billed, collected, outstanding, pending billing requests |
| Billing Requests | Approve/reject PM billing requests |
| Billing Statements | Issued statements across all clients |
| Payments | Record payments manually, verify/reject client proofs |
| Client Directory | Create/edit client records, assign account managers |

## 5. Full database schema (ERD) explained

See `ALEK_Consultants_ERD.pdf` for the visual diagram. This section walks
through every table, field by field, and how they connect. `PK` = primary
key, `FK` = foreign key (points to another table's `id`).


### auth.users
Supabase's built-in authentication table. Every login account lives here;
it's the source of truth for who can log in at all. Not something the app
manages directly.

- `id` (PK) — unique account id, generated by Supabase Auth

### profiles
One row per user, extending `auth.users` with app-specific info. This is
the table `current_user_role()` reads from every time an RLS policy needs
to know "who is this and what can they do."

- `id` (PK, FK → auth.users.id) — same id as the auth account, 1-to-1
- `full_name` — display name
- `role` — `client`, `pm`, or `admin` (Finance Admin) — this single field
  drives almost every RLS policy in the system
- `client_id` (FK → clients.id) — only set for client-role users; links
  them to the one client company they belong to
- `status` — active/inactive account flag
- `contact` — phone/contact info

### roles
A small lookup/reference table, not directly joined by RLS — mainly feeds
dropdowns and labels in the UI so role names stay consistent.

- `role_id` (PK)
- `role_name`

### clients
Company records — the organizations that request and pay for projects.

- `id` (PK)
- `name` — company name
- `contact_number`
- `account_manager_id` (FK → profiles.id) — which PM/admin is the client's
  point of contact
- `email` *(added by workflow schema)*
- `address` *(added by workflow schema)*

### projects
The real, approved projects — only created after a `project_requests` row
is confirmed by the client.

- `id` (PK)
- `name`
- `client_id` (FK → clients.id) — which company owns this project
- `pm_id` (FK → profiles.id) — assigned project manager
- `financial_admin_id` (FK → profiles.id) — assigned finance admin
- `contract_amount` — total contract value
- `status` — free text; UI restricts it to Planning, Mobilization,
  Ongoing, For Review, Completed, Closed
- `location`, `description`, `project_type`
- `notice_of_award_date`, `notice_to_proceed_date` — NOA/NTP dates from
  the business process
- `working_days`, `completion_date`, `additional_costs`
- `progress_percentage` *(added by workflow schema)* — 0 to 100, drives the
  progress bar in the UI

### consultation_requests *(new)*
The client's actual originating action in the process diagram — "I have a
problem, please assess it." Deliberately thin: no project type or budget,
because the client hasn't had the offline assessment yet.

- `id` (PK)
- `client_id` (FK → clients.id) — who's asking
- `requested_by` (FK → profiles.id) — which specific client user sent it
- `message` — free text description of the need
- `status` — `new` → `contacted` → `closed`
- `handled_by` (FK → profiles.id) — which PM picked it up
- `created_at`, `handled_at`

### project_requests (project proposals)
The proposal ALEK prepares after the offline consultation, before the
client has confirmed it into a real project.

- `id` (PK)
- `client_id` (FK → clients.id) — who the proposal is for
- `requested_by` (FK → profiles.id) — **the PM who authored the proposal**
- `consultation_request_id` (FK → consultation_requests.id) *(added by
  workflow schema)* — optional link back to the consultation that triggered
  this proposal
- `title`, `location`, `project_type`, `description`
- `estimated_budget`, `preferred_start_date`
- `status` — `pending` → `confirmed`/`declined`
- `reviewed_by` (FK → profiles.id) — **the Client user who confirmed or
  declined it**
- `review_notes` — the client's confirmation/decline notes
- `converted_project_id` (FK → projects.id) — set once confirmed and
  turned into a real project; this is the link between "proposal" and
  "actual project"
- `created_at`, `reviewed_at`

### billing_requests
The PM's request to issue a bill, before it becomes an official statement.

- `id` (PK)
- `project_id` (FK → projects.id) — which project this bill is for
- `requested_by` (FK → profiles.id) — which PM requested it
- `requested_amount`, `description`
- `billing_type` — `mobilization` / `progress` / `final` / `other`
- `status` — `pending` / `approved` / `rejected`
- `reviewed_by` (FK → profiles.id) — which Finance Admin reviewed it
- `review_notes`
- `billing_id` (FK → billing.id) — set once approved, links to the real
  statement it produced
- `created_at`, `reviewed_at`

### billing
The real, official billing statements — the ones clients actually see and
owe money against.

- `id` (PK)
- `project_id` (FK → projects.id)
- `amount` — the billed amount
- `status` — e.g. `unpaid`, `paid`, partially paid
- `description`, `billing_type`, `date_issued` *(billing_type,
  description added by workflow schema)*
- `balance_left` — auto-maintained by a trigger every time a payment lands
- `source_request_id` (FK → billing_requests.id) *(added by workflow
  schema)* — traces this statement back to the request that produced it
  (null if Finance Admin issued it directly with no PM request behind it,
  e.g. a correction)

### payments
The real, recorded payments — the only table that actually reduces a
client's balance.

- `id` (PK)
- `billing_id` (FK → billing.id) — which statement this payment applies to
- `amount_paid`, `payment_date`, `payment_method`, `notes`
- `recorded_by` (FK → profiles.id) — which Finance Admin recorded it
  (either typed in manually, or filled in automatically by
  `verify_payment_proof()`)

### payment_proofs
The client's claim of having paid, before Finance Admin confirms it's real.

- `id` (PK)
- `billing_id` (FK → billing.id) — which statement they're paying
- `uploaded_by` (FK → profiles.id) — which client user uploaded it
- `file_name`, `storage_path` — the receipt/screenshot file
- `amount_claimed`, `notes`
- `status` — `pending` / `verified` / `rejected`
- `reviewed_by` (FK → profiles.id) — which Finance Admin reviewed it
- `reviewed_at`
- `payment_id` (FK → payments.id) — set once verified, links to the real
  payment row it produced
- `created_at`

### project_documents
File index for project paperwork — NOA, NTP, Contract, Plans, Engineering
Reports, Billing Attachments, Completion Documents. The actual files live
in Supabase Storage; this table is just the searchable index pointing to
them.

- `id` (PK)
- `project_id` (FK → projects.id)
- `doc_type` — one of the categories above, or `other`
- `file_name`, `storage_path`
- `uploaded_by` (FK → profiles.id)
- `uploaded_at`

### How the tables connect, end to end

```
auth.users → profiles → clients → consultation_requests
                                          │
                                          ▼
                                  project_requests → projects
                                                          │
                                                          ▼
                                              billing_requests → billing
                                                                    │
                                              ┌─────────────────────┘
                                              ▼
                                          payments ← payment_proofs
```

Reading it left to right: every user is a `profiles` row tied to
`auth.users`; a client user belongs to one `clients` company; that company
can send `consultation_requests` (optional context) and receives
`project_requests` (proposals) authored by a PM, which — once the client
confirms — become real `projects`; each project can generate
`billing_requests`, which — once approved — become real `billing`
statements; each statement can receive either a direct `payments` entry or
a client-submitted `payment_proofs` claim that, once verified, also
produces a `payments` row.

Eight `security definer` functions are the only sanctioned way to move a
request into its "real" record, or to claim one: `confirm_project_request`,
`decline_project_request`, `approve_billing_request`,
`reject_billing_request`, `verify_payment_proof`, `reject_payment_proof`,
and (added in §9) `claim_consultation_request`, `close_consultation_request`.
Each re-checks the caller's role before doing anything, so the approval
rule can't be bypassed by calling the underlying table directly.

## 6. Why the approval layer was added — and why it was later flipped

The original spec allowed each role to create its own records directly (PM
creates projects, Finance Admin creates billing statements, client creates
payments). During development, this was identified as a gap: nothing
stopped a single role from creating a record with no review, and nothing
gave the client a structured way to request a project or verified their
payment claims. The request → review → approve pattern was added to close
that gap while keeping the same end result each role is responsible for in
the spec — the PM still creates the project, Finance Admin still issues the
statement — just with a review step in front of it.

The first version of this pattern had the **client** submit a fully-specced
project request (title, type, budget, etc.) and the **PM** approve it. On
review against the original Business Process diagram, that didn't hold up:
the diagram shows the client originating nothing but a bare consultation
request, with ALEK doing the assessment and proposal offline. It doesn't
make sense for a client to specify a project type or a defensible budget
before any assessment has happened. So the workflow was flipped: the **PM**
authors the proposal after the offline consultation, and the **client**
confirms or declines it — matching the diagram's NOA/NTP step. A thin
`consultation_requests` table was added alongside it so the client still has
a genuine entry point into the system, just one that matches what they'd
actually originate.

## 7. Anticipated questions

**Q: Why did you add `consultation_requests`, `project_requests`, and
`billing_requests` when the original spec didn't mention them?**
The spec's CRUD list says PM "creates" projects and Finance Admin "creates"
billing statements — but it never says how that action gets triggered, or
gives the client any way to ask for one. We kept the same end
responsibility (PM still creates the project, Finance Admin still issues
the statement) and added a request/review step in front of it, so nothing
gets created without a review trail. `consultation_requests` specifically
mirrors the diagram's own starting event, so the client's entry point isn't
overstated into something they wouldn't actually know how to fill in.

**Q: Doesn't this contradict the spec?**
Not for the end responsibility — the "create" action for projects and
billing statements still belongs to the same role the spec assigns it to.
The closest deviation is `payment_proofs`: the spec says the client
"creates payment information" directly. In our version the client only
submits a proof, and Finance Admin verifies it into the real `payments`
row — defensible as a fraud-prevention measure (an unverified client claim
shouldn't count as an actual payment), but worth naming up front.

**Q: Why does the PM author the project proposal instead of the client
submitting a request?**
Because that's what the Business Process diagram actually shows. The
client's only originating action is a consultation request; assessing the
problem and preparing the proposal (type, scope, budget) happens inside
ALEK's lane, offline, before anything is entered into the system. The
client's real next step is *receiving* the proposal and confirming it —
their NOA/NTP. Having the client fill in project type and estimated budget
before an assessment ever happened didn't match that.

**Q: What is `billing_type` and why do we need it?**
It classifies *why* a bill was issued: `mobilization` (initial setup
charge, usually right after NTP), `progress` (tied to percent of work
done), `final` (last bill, closes out the balance), or `other`
(adjustments/one-offs, also the default). It's set once by the PM on the
billing request and copied over unchanged when Finance Admin approves it
— so the classification is locked in at request time, not decided twice.
It exists for reporting/traceability, not for the percentage math itself
(that lives in `amount`, `balance_left`, and `progress_percentage`).

**Q: Why use `security definer` functions instead of just RLS policies?**
RLS alone can restrict who can `INSERT`/`UPDATE` a table, but approving a
request needs *two* things to happen together — mark the request
confirmed/approved AND create the real row — as one atomic action. If we
did this as two separate app-side calls, a crash or bug between them could
leave a request marked "confirmed" with no project behind it, or vice
versa. Wrapping both writes in one `security definer` function makes it
atomic and re-checks the caller's role inside the function itself, so it
can't be bypassed by calling the underlying table directly.

**Q: What stops a PM from just inserting into `billing` directly?**
RLS on the `billing` table only grants `INSERT` through the
`approve_billing_request()` function's internal write (which runs as the
function owner, not the calling PM). The PM's own role has no `INSERT`
policy on `billing` at all — their only writable table for billing is
`billing_requests`.

**Q: What stops a client from confirming someone else's proposal, or a PM
from confirming their own?**
`confirm_project_request()`/`decline_project_request()` both check
`public.current_user_role() = 'client'` and require the row's `client_id`
to match the caller's own `current_user_client_id()`. A PM has no `UPDATE`
policy on `project_requests` at all — their only writable path is
`INSERT` (authoring a new proposal).

**Q: How does `balance_left` stay accurate?**
It's maintained by a trigger (from the base schema migration) that
recalculates it whenever a row is inserted into `payments`. Since
`payments` can only be written to via a Finance Admin's manual entry or
`verify_payment_proof()`, `balance_left` can never drift from an
unverified or fake payment.

**Q: What's the difference between `project_requests.status` and
`projects.status`?**
`project_requests.status` only tracks the proposal's confirmation state
(`pending` → `confirmed`/`declined`) and freezes once the client responds.
`projects.status` tracks the project's actual execution state (Planning,
Mobilization, Ongoing, For Review, Completed, Closed) and keeps changing
throughout the project's life — it only starts once the proposal is
confirmed and the project is created.

**Q: Why is `role` stored as text on `profiles` instead of a foreign key
to the `roles` table?**
`roles` exists as a reference/lookup table (role_id, role_name), but the
RLS policies and the `current_user_role()` helper function read
`profiles.role` directly as text for simplicity and performance — every
policy check is a single-column comparison instead of a join. `roles` is
mainly there for the UI to populate dropdowns/labels consistently.

**Q: What happens if two people try to confirm/approve the same request at
the same time?**
Every review function checks `status = 'pending'` in its `WHERE` clause
before updating. Whoever's transaction commits first flips the status; the
second call finds no matching row left to update — the function raises an
exception instead — so it can't be double-confirmed or double-converted
into two projects (or two billing statements, for billing requests).

**Q: Why keep `projects.status` as free text instead of a proper enum/
check constraint like the other status columns?**
So existing rows and any legacy status values already in the table don't
get invalidated by the migration. The six spec statuses (Planning,
Mobilization, Ongoing, For Review, Completed, Closed) are enforced at the
UI level — the dropdown only offers those six — rather than at the
database level.

## 8. Changelog — fixes and additions (this revision)

These are cumulative fixes and features added on top of the original
redesign, in the order they came up. Some are frontend-only; several later
ones (marked clearly below) needed matching database changes.

> **Database setup:** every SQL change described in entries 9, 12, and 19
> below has been consolidated into **`supabase/schema_final.sql`** — run
> that ONE file (after `schema_alignment.sql`) instead of hunting for each
> individual migration mentioned in the text. The entries below are kept
> as-written for the history/reasoning; where they say "run this file,"
> that specific file no longer exists on its own — it's folded into
> `schema_final.sql` now. Two more files are NOT schema, and stay separate
> because they're data operations you run only when you want them:
> `supabase/clear_business_data.sql` (wipes business data, keeps accounts)
> and `supabase/seed_dummy_data.sql` (demo data for testing/presentation).

1. **`billing.html` — client no longer prompted to upload proof after a
   statement is already settled.** The "Upload Proof of Payment" button used
   to render unconditionally for every statement row, even ones already
   `paid` (e.g. because Finance Admin recorded an offline payment directly).
   It now shows a "Settled" indicator instead once `status = 'paid'` or
   `balance_left <= 0`. Proof upload was always optional by design (see the
   modal's own copy), this just stops the UI from implying it's still needed.

2. **`billing.html` — Finance Admin had no way to reach direct statement
   issuance.** `new-billing.html` (the "issue a statement without a PM
   request first" form, meant for corrections/adjustments per §6) existed
   but nothing linked to it for admins. Added an "Issue Statement Directly"
   button, visible only to `admin`.

3. **`dashboard.html` — "New Project" button was wrong for every role.** It
   showed for all three roles and linked to `projects.html` (the list page),
   not the actual create form — so even a PM clicking it didn't reach
   `new-project.html`. Now restricted to `pm` and points at the correct
   page; `admin` gets a "View Projects" link instead.

4. **`style.css` — billing statement status pills had no color coding.**
   `PAID` / `UNPAID` / `PARTIALLY_PAID` fell back to plain gray, unlike every
   other status pill in the system. Added `.status-paid` (green),
   `.status-unpaid` (red), `.status-partially_paid` (amber) rules consistent
   with the existing palette.

5. **`billing-requests.html` — a PM could request billing against a closed
   project.** The "Choose a Project" dropdown loaded every project assigned
   to the PM with no status filter, including `closed` ones (fully wrapped
   up — billing included). Now excludes `status = 'closed'`. `completed` is
   deliberately still included, since Final Billing normally happens *after*
   completion (see fix 6).

6. **`billing-requests.html` — Billing Type isn't locked for completed
   projects.** When the selected project's status is `completed`, the
   Billing Type dropdown now locks to `final` only (mobilization/progress/
   other are disabled) and shows an inline explanation. This guides the PM
   toward the correct billing type instead of leaving it open-ended once
   the work itself is done.

7. **`requests.html` — stale proposal data could leak between drafts.** The
   "New Project Proposal" modal only cleared its fields (title, location,
   description, budget, start date) *after* a successful submit — never on
   open or on cancel. Opening it from a Consultation (which auto-fills the
   description) and then cancelling, then opening it again for an unrelated
   client, would carry the old text over. The modal now clears all fields
   every time it opens, before applying any consultation-linked prefill.

8. **`requests.html` — consultation requests had no assignment/claim logic.**
   With multiple PMs, the Consultation Requests inbox was a fully shared,
   unassigned list — any PM could "Mark Contacted" or "Create Proposal" on
   any request, with no record of who actually picked it up (the schema's
   own `handled_by` field existed but was never written to), risking two
   engineers contacting the same client. Two things changed:
   - "Mark Contacted" now claims the request — the first PM to claim it
     locks its "Mark Contacted" / "Create Proposal" actions for every other
     PM (both buttons show disabled, with a "Claimed by <name>" note).
   - If the client already has a standing account manager (`clients.
     account_manager_id`, set by admin in Add/Edit Client), that PM's copy
     of the inbox tags the row "Your Client"; other PMs see "Preferred:
     <name>" instead. This is a priority signal only, not a hard
     restriction — if the preferred engineer is unavailable, any other PM
     can still claim it. No new field was added to the client-facing
     Request a Consultation form; this reuses the existing account manager
     relationship.

9. **`supabase/consultation_claim_hardening.sql` (new file) — the claim in
   fix 8 is now enforced by the database, not just the UI.** The workflow-
   completion schema's `consultation_requests_update` RLS policy only
   checked `role = 'pm'`, with no restriction based on `handled_by` — so
   the disabled buttons in fix 8 were cosmetic only; any PM could still call
   `.update()` on the table directly and overwrite another PM's claim.
   Separately, converting a consultation straight into a proposal (skipping
   "Mark Contacted") closed the consultation without ever setting
   `handled_by`, losing the attribution entirely. This migration adds two
   `security definer` functions — `claim_consultation_request()` and
   `close_consultation_request()` — following the same "one sanctioned
   path" pattern already used for `approve_billing_request()` and
   `confirm_project_request()`, and drops the open PM update policy so
   these functions are the only way in. `requests.html`'s `markContacted()`
   and `submitProposal()` now call these RPCs instead of writing to the
   table directly. **Run `supabase/consultation_claim_hardening.sql` in the
   Supabase SQL Editor after the workflow-completion schema for this to
   take effect** — the frontend changes alone do nothing without it.

10. **`style.css` + all KPI card rows — stat cards had oversized spacing.**
    `.kpi-card` set `padding: 2rem 2.2rem` in the CSS while every instance
    in the HTML *also* had Bootstrap's `p-4` (1.5rem) utility class on it —
    the CSS rule won the cascade, so cards ended up bulkier than the markup
    intended, and combined with the `g-4`/`mb-5` grid spacing (24px gutter +
    48px bottom margin) made the whole stat-card grid look overly spread
    out (this is what the PM dashboard screenshot showed). Reduced
    `.kpi-card` padding to `1.35rem 1.6rem` and tightened every KPI grid
    row site-wide (dashboard, projects, billing, clients, requests,
    billing-requests) from `g-4 mb-5` to `g-3 mb-4`.

11. **`signup.html` — public signup could create staff (PM) accounts.**
    Anyone reaching the public signup page could self-register as a Project
    Manager, not just a Client — no legitimate system should let internal
    staff accounts be created through a page anyone can find. The role
    dropdown is now hidden by default (public signup is Client-only). A
    hidden staff mode (`signup.html?staff=1`) reveals a role picker with
    Project Manager and Finance Admin options — this link is only exposed
    from the new Users page (fix 13), for an existing Finance Admin to share
    when onboarding a new staff member.

12. **`supabase/user_management_and_proposal_edit.sql` (new file).** Two
    additive RLS policies needed for fixes 13 and 15:
    - `profiles_admin_manage`: lets `admin` update any profile's role,
      name, or client link (needed for the Users page). Nothing previously
      granted this — profile RLS from `schema_alignment.sql` is presumably
      self-row-only, correct for a normal user but with no path for an
      admin to manage *other* people's accounts.
    - `project_requests_update_pm` / `project_requests_delete_pm`: lets a
      PM edit or withdraw their **own** proposal while it's still
      `pending` — deliberately excludes `confirmed`/`declined` proposals,
      since the client has already acted on those as written. **Run this
      file in the Supabase SQL Editor** (after the two prior migrations)
      for fixes 13 and 15 to work — the frontend calls depend on it.

13. **`views/users.html` (new page) — no way to see or manage system
    accounts.** Lists every account (name, role, linked client company if
    any) with counts by role. Admin can change a user's role or client link
    from an edit modal. Includes the link to staff signup from fix 11.
    Added to the sidebar nav (`data-role="admin"`) on all 10 pages that have
    a sidebar. Note: the page can't show email addresses — `profiles`
    doesn't store one (it lives in `auth.users`, not exposed to normal
    client queries); would need an edge function or admin API to add safely.

14. **`views/projects.html` — no way to retire a finished/cancelled
    project.** Added an "Archive Project" button (`admin` only) in the
    project details modal. Deliberately does **not** hard-delete — a
    project is referenced by billing, documents, and payments, so removing
    the row would orphan all of that. Archiving just sets `status =
    'closed'` (already one of the six spec statuses) through the same
    update path `saveProjectDetails` uses, so it inherits the same RLS.
    (Editing a project's own fields was already fully supported before this
    session — client, PM, location, dates, cost, etc. — that part of the
    original "edit/delete projects" ask was already done.)

15. **`views/requests.html` — a PM could not fix or pull back their own
    proposal.** Previously proposals were create-only; a typo or a proposal
    sent to the wrong client had no recovery besides asking the client to
    decline it. Added, both restricted to the proposal's own author and
    only while `status = 'pending'`:
    - **Edit** — reopens the same "Prepare a Project Proposal" modal
      pre-filled, and updates the existing row instead of creating a new
      one.
    - **Withdraw** — deletes the proposal outright. Safe as a hard delete
      specifically because nothing else references a still-pending
      proposal (no billing, no documents, no converted project) — once
      confirmed/declined it becomes a historical record and neither button
      is offered anymore.
    Requires fix 12's SQL to be run first.

16. **Input validation added on amount and contact-info fields**, previously
    only checked for "not empty," not for being a sane value:
    - `views/billing-requests.html`, `views/new-billing.html`,
      `views/payments.html` (`recordPayment`) — billing/payment amounts
      must now be a valid number greater than 0. (`payments.html`'s
      `verifyProof` already had this check; it was inconsistent with the
      other three amount fields in the system, now aligned.)
    - `views/projects.html` (`saveProjectDetails`) — Project Cost,
      Additional Costs, Working Days must be 0 or more; the `min="0"` HTML
      attribute alone doesn't reliably block a pasted or programmatically
      set negative value.
    - `views/requests.html` (`submitProposal`) — Estimated Budget must be 0
      or more.
    - `views/new-client.html`, `views/clients.html` — email and contact
      number now go through shared `isValidEmail()` / `isValidPhone()`
      helpers (added to `assets/js/auth.js`) before save. Deliberately
      loose (shape-checking, not strict RFC validation) — the goal is
      catching obvious typos, not rejecting unusual-but-valid input.

17. **`supabase/seed_dummy_data.sql` (new file) — demo data for
    presentations/testing.** Split into two parts because `profiles.id` is
    a foreign key to `auth.users.id` — there's no way to fabricate a fake
    "user" via plain SQL, only through the real signup flow or an Auth
    Admin API this frontend-only project doesn't have access to. **Part 1**
    (run anytime) seeds five example client companies — no accounts needed.
    **Part 2** is a template: sign up 3 real test accounts (client/PM/admin)
    through the app first, paste their profile UUIDs into the three
    placeholders in the script, then run it — it links the test client to a
    seeded company, and creates one open consultation request, one
    confirmed-and-converted proposal/project, one paid billing statement,
    and one unpaid billing statement, so every role sees something on first
    login instead of an empty dashboard.

18. **`supabase/clear_business_data.sql` (new file) — reset script for
    testing.** Deletes every business-data table in FK-safe order.
    Deliberately does **not** touch `profiles` or `auth.users` — accounts
    stay logged in and working; only business data is wiped. Deleting
    accounts has to be done from Supabase's Authentication tab directly,
    since `auth.users` isn't reachable from plain SQL the way the rest of
    the schema is.

    **Bugfixed after first real use:** the original version got the order
    wrong in two places, both caught by a live "violates foreign key
    constraint" error when actually run:
    - `billing` and `billing_requests` reference **each other**
      (`billing_requests.billing_id → billing.id`, AND
      `billing.source_request_id → billing_requests.id`) — a circular FK.
      No single delete order can satisfy that; both link columns have to be
      set to `null` first to break the cycle, then both tables deleted.
    - `project_requests.converted_project_id → projects.id` means
      `project_requests` had to be deleted **before** `projects`, not
      after — the original order had that backwards.
    - Also added: `profiles.client_id → clients.id`. Since `profiles` rows
      are deliberately kept (accounts stay), a client account still
      pointing at a client row about to be deleted would hit the same kind
      of error — that link is now nulled out before `clients` is deleted
      (the account itself is unaffected, it just needs a new client company
      linked afterward, e.g. from the Users page).

19. **Payment Proof upload removed — payments are offline-only now.** The
    schema's own comment on `payment_proofs` already called it optional
    ("Spec module 8, Client Portal, **optional**"). It added real
    complexity (three proof states, two extra RPCs, a storage bucket) for a
    feature that was never required — the "Record Payment" flow alone
    (Finance Admin manually enters amount + reference number,
    `balance_left` updates automatically) already fully covers the
    spec requirement. Removed:
    - `views/billing.html` — the "Upload Proof of Payment" button/modal is
      gone; the client's last table column is now a plain read-only
      "Settled" / "Awaiting payment" indicator, nothing to act on.
    - `views/payments.html` — the "Pending Proofs" tab is gone; Finance
      Admin sees a single "All Recorded Payments" list with "Record
      Payment," no tab navigation needed anymore.
    - `supabase/retire_payment_proofs.sql` (new file) — drops the
      `payment_proofs` table's SELECT/INSERT/UPDATE policies and its
      storage bucket policies, so nothing can write to it even via a direct
      API call bypassing the UI (same principle as
      `consultation_claim_hardening.sql`: don't just hide a removed feature
      in the UI, close it at the database too). The table itself and
      `verify_payment_proof()` / `reject_payment_proof()` are left in
      place, untouched — they're harmless with no INSERT policy feeding
      them, and it means the feature is fully reversible later by
      re-creating just those five policies.
