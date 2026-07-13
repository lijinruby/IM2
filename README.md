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

> **Note:** `auth.users`, `profiles`, `roles`, `clients` (base fields),
> `projects` (base fields), `billing` (base fields), and `payments` come from
> the original base schema (`schema_alignment.sql`), not the workflow
> migration. Everything from `consultation_requests` onward, plus the
> additive columns called out below, comes from the workflow-completion
> schema.

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

Six `security definer` functions are the only sanctioned way to move a
request into its "real" record: `confirm_project_request`,
`decline_project_request`, `approve_billing_request`,
`reject_billing_request`, `verify_payment_proof`, `reject_payment_proof`.
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