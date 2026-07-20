# ALEK Consultants — Project Management & Billing System

![Under construction but in a fun way](https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif)

A web app for **ALEK Consultants Inc.** that manages the full lifecycle of a
project: from a client's initial consultation request, through an
ALEK-authored proposal, client confirmation, execution, billing, and payment
collection.

This README reflects the **current, final state** of the system after all
revisions. Where earlier decisions were later changed (e.g. the billing
approval workflow, or how client accounts are modeled), only the final
behavior is described in the main sections — the reasoning and history for
those changes lives in **§8 Design history** and **§9 Changelog**.

---

## 1. User roles

| Role | Can do |
|---|---|
| **Client** | Request a consultation, confirm or decline project proposals, view their own projects and billing statements, view payment history |
| **Project Manager (PM)** | Handle incoming consultation requests, author project proposals after an offline assessment, create and manage projects once a proposal is confirmed, flag a project as ready to bill |
| **Finance Admin** | Issue billing statements directly, record payments, manage client (company) accounts and user roles |

Roles are enforced at the database level via Supabase Row Level Security
(RLS) — a role can only see or modify the rows it's actually allowed to,
regardless of what the front end shows.

**A client account is a company account.** There is no separate `clients`
table — a client user's own profile carries the company info (name, contact
number, email, address, assigned account manager). This keeps every
existing relationship (consultations, proposals, projects) pointing at the
same id it always did, just aimed at `profiles` instead of a separate table.

## 2. Core business process

The base process (client consultation request → PM assessment → proposal →
NOA/NTP → execution → billing → payment) is intentionally lightweight on
approval layers. The two sensitive creation actions — starting a project and
issuing a billing statement — are handled as follows:

- **Projects** are never created directly by a client request. The client's
  only originating action is a bare **consultation request**; the PM does
  the assessment and prepares the proposal offline, the client confirms it
  (their equivalent of Notice of Award / Notice to Proceed), and only then
  does the PM create the actual project record.
- **Billing statements** are issued directly by Finance Admin — there is no
  PM-submitted billing request or approval queue. A PM can flag a project as
  "ready to bill" as a lightweight, one-way signal to Finance Admin, but
  this doesn't gate or block anything; Finance Admin can issue a statement
  for any project at any time.

## 3. The workflows

### 3.1 Consultation request → PM contact

1. **Client** opens **Project Proposals** and sends a **Consultation
   Request** — just a message describing what they need. No project type or
   budget; that hasn't been assessed yet.
2. **PM** sees it in the Consultation Requests inbox and **claims** it by
   marking it **Contacted**. Claiming is enforced at the database level, not
   just the UI — once one PM claims a request, no other PM can act on it. If
   the client already has a standing account manager, that PM's copy of the
   inbox is tagged "Your Client" as a priority signal (not a hard
   restriction — any PM can still claim it if the preferred engineer is
   unavailable).
3. The consultation isn't a record that "becomes" anything by itself — it's
   context. The PM's actual next step is authoring a proposal (3.2), which
   can optionally link back to the consultation that triggered it. Closing a
   consultation (directly, or by converting it into a proposal) always
   records who handled it.

### 3.2 Project proposal → client confirmation → project

1. **PM** opens **Project Proposals** and, after the offline consultation,
   clicks **New Project Proposal**: chooses the client, then fills in title,
   location, project type, description, estimated budget, and preferred
   start date. Status starts as `pending`.
2. While a proposal is still `pending`, the authoring PM can **edit** it
   (typo fixes, wrong client, etc.) or **withdraw** it outright. Once the
   client has confirmed or declined it, neither action is offered — it's a
   historical record from that point on.
3. **Client** sees it under their own **Project Proposals** and clicks
   **Review**, then **Confirm** or **Decline** with an optional note. This
   is the client's NOA/NTP moment.
4. Confirming does **not** create the project automatically — it opens the
   **Create Project** form pre-filled with the proposal's details. The PM
   fills in the remaining fields (contract amount, dates, financial admin)
   and submits.
5. Only at that point does a row exist in the `projects` table, linked back
   to the original proposal.

### 3.3 Billing → payment

1. **Finance Admin** issues a billing statement directly against a project:
   amount, description. It appears immediately on **Billing Statements**,
   visible to the client it belongs to.
2. Optionally, a **PM** can flag their own project as **"Ready to Bill"**
   from Project Portfolio, with a short note — a one-way nudge to Finance
   Admin, not a request that needs approval. A closed project with nothing
   left owing can't be flagged, since there's nothing left to bill.
3. **Client** sees the statement's outstanding balance on **Billing
   Statements**. Once fully paid, the row shows a plain "Settled" indicator
   — there's no client-side action to take (see §8 for why payment proof
   upload was removed).
4. **Finance Admin** records the payment on the **Payments** page (amount,
   date, method, reference notes). Recording a payment automatically
   recalculates the statement's outstanding balance and status, guards
   against overpayment, and stamps the payment with a unique,
   auto-generated receipt number the Finance Admin can hand to the client as
   a printable acknowledgement receipt. Recording a payment is the **only**
   path into the `payments` table — nothing else writes to it.

## 4. Screen-by-screen walkthrough

### As Client
| Screen | What happens |
|---|---|
| Dashboard | Own project count, balance, payment status |
| Project Proposals | Request a consultation, review and confirm/decline proposals PM sends, track status (`pending` → `confirmed`/`declined`) |
| Billing Statements | View statements and balances (read-only) |
| Payments | View own payment history, including receipt numbers (read-only) |
| Profile | Own company/contact details, job title |

### As Project Manager
| Screen | What happens |
|---|---|
| Dashboard | Own assigned projects, proposals still awaiting client confirmation |
| Project Proposals | Handle the Consultation Requests inbox (claim, mark contacted); author, edit, or withdraw proposals; track confirmation status |
| Create Project | Pre-filled form after a client confirms a proposal |
| Project Portfolio | Manage own projects, update status/progress, flag "Ready to Bill" |
| Profile | Own contact details, job title |

### As Finance Admin
| Screen | What happens |
|---|---|
| Dashboard | System-wide totals: billed, collected, outstanding |
| Billing Statements | Issue statements directly against any project; view all issued statements |
| Payments | Record payments, generate/print receipts |
| Reports | Billing reconciliation view — surfaces any drift between a statement's stored balance and what its payments actually add up to |
| Users | View every account, manage roles and client/company links, share the staff signup link for onboarding new PMs or Finance Admins |
| Profile | Own contact details, job title |

## 5. Database schema explained

`PK` = primary key, `FK` = foreign key (points to another table's `id`).

### auth.users
Supabase's built-in authentication table. Every login account lives here;
it's the source of truth for who can log in at all. Not something the app
manages directly.

- `id` (PK) — unique account id, generated by Supabase Auth

### profiles
One row per user, extending `auth.users` with app-specific info. This is
the table `current_user_role()` reads from every time an RLS policy needs
to know "who is this and what can they do." For a client-role user, this
row **is** the company record — there is no separate clients table.

- `id` (PK, FK → auth.users.id) — same id as the auth account, 1-to-1
- `full_name` — display name
- `role` — `client`, `pm`, or `admin` (Finance Admin) — this single field
  drives almost every RLS policy in the system
- `job_title` — optional (e.g. "Structural Engineer," "Senior PM," or a
  client contact's title)
- `status` — active/inactive account flag
- `contact` — phone/contact info
- `company_name`, `contact_number`, `email`, `address` — set for
  client-role users; represents the company they belong to
- `account_manager_id` (FK → profiles.id) — for a client-role user, which
  PM/admin is their point of contact

### projects
The real, approved projects — only created after a proposal is confirmed by
the client.

- `id` (PK)
- `name`
- `client_id` (FK → profiles.id) — which client/company owns this project
- `pm_id` (FK → profiles.id) — assigned project manager
- `financial_admin_id` (FK → profiles.id) — assigned finance admin
- `contract_amount` — total contract value
- `status` — free text; UI restricts it to Planning, Mobilization,
  Ongoing, For Review, Completed, Closed
- `location`, `description`, `project_type`
- `notice_of_award_date`, `notice_to_proceed_date` — NOA/NTP dates from
  the business process
- `working_days`, `completion_date`, `additional_costs`
- `progress_percentage` — 0 to 100, drives the progress bar in the UI
- `billing_flagged`, `billing_flag_note`, `billing_flagged_at` — the PM's
  lightweight "ready to bill" signal to Finance Admin

### consultation_requests
The client's actual originating action in the process — "I have a problem,
please assess it." Deliberately thin: no project type or budget, because
the client hasn't had the offline assessment yet.

- `id` (PK)
- `client_id` (FK → profiles.id) — who's asking
- `requested_by` (FK → profiles.id) — which specific client user sent it
- `message` — free text description of the need
- `status` — `new` → `contacted` → `closed`
- `handled_by` (FK → profiles.id) — which PM claimed/handled it
- `created_at`, `handled_at`

### project_requests (project proposals)
The proposal ALEK prepares after the offline consultation, before the
client has confirmed it into a real project.

- `id` (PK)
- `client_id` (FK → profiles.id) — who the proposal is for
- `requested_by` (FK → profiles.id) — the PM who authored the proposal
- `consultation_request_id` (FK → consultation_requests.id) — optional
  link back to the consultation that triggered this proposal
- `title`, `location`, `project_type`, `description`
- `estimated_budget`, `preferred_start_date`
- `status` — `pending` → `confirmed`/`declined`
- `reviewed_by` (FK → profiles.id) — the client user who confirmed or
  declined it
- `review_notes` — the client's confirmation/decline notes
- `converted_project_id` (FK → projects.id) — set once confirmed and
  turned into a real project
- `created_at`, `reviewed_at`

### billing
The real, official billing statements — the ones clients actually see and
owe money against. Issued directly by Finance Admin.

- `id` (PK)
- `project_id` (FK → projects.id)
- `amount` — the billed amount
- `status` — e.g. `unpaid`, `paid`, partially paid
- `description`, `date_issued`
- `balance_left` — auto-maintained by a trigger every time a payment lands

### payments
The real, recorded payments — the only table that actually reduces a
client's balance.

- `id` (PK)
- `billing_id` (FK → billing.id) — which statement this payment applies to
- `amount_paid`, `payment_date`, `payment_method`, `notes`
- `receipt_no` — unique, auto-generated at insert time (e.g. `AR-000123`);
  never typed by the UI, so it can't be mistyped or duplicated. Used to
  generate a printable acknowledgement receipt.
- `recorded_by` (FK → profiles.id) — which Finance Admin recorded it

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
auth.users → profiles (client role = company) → consultation_requests
                                                        │
                                                        ▼
                                                project_requests → projects
                                                                       │
                                                                       ▼
                                                                    billing
                                                                       │
                                                                       ▼
                                                                   payments
```

Reading it left to right: every user is a `profiles` row tied to
`auth.users`; a client-role profile represents both the person and the
company; that company can send `consultation_requests` (optional context)
and receives `project_requests` (proposals) authored by a PM, which — once
the client confirms — become real `projects`; Finance Admin issues `billing`
statements directly against a project; recording a payment inserts into
`payments`, which recalculates the statement's balance automatically.

A handful of `security definer` functions are the sanctioned way to move a
request into its "real" record, or to claim one — confirming/declining a
proposal, claiming/closing a consultation, and admin profile management.
Each re-checks the caller's role before doing anything, so the rule can't be
bypassed by calling the underlying table directly.

## 6. Screens no longer used

A few things described in earlier drafts of this system were removed and
are **not** part of the current app, kept here only so old references make
sense:

- **PM-submitted billing requests with Finance Admin approval** — replaced
  by Finance Admin issuing statements directly, with a lightweight
  PM-side "Ready to Bill" flag instead of a request/approval queue.
- **Client-uploaded payment proof** — removed. Payments are recorded
  directly by Finance Admin (offline-verified), and the client side simply
  shows a "Settled" / "Awaiting payment" indicator with nothing to act on.
- **A separate `clients` table** — merged into `profiles`; a client account
  now *is* the company account.

## 7. Design history

A short account of why certain decisions were made, then later changed:

- **Approval layers, added then removed.** The original design let PM
  create projects and Finance Admin issue billing statements directly, with
  no review step and no structured way for a client to originate a request.
  A request → review → approve pattern was added so nothing got created
  without a trail — but for billing specifically, the "review" step never
  actually rejected anything in practice, so it was later simplified to
  direct issuance plus a one-way "Ready to Bill" signal. The project
  proposal flow kept its review step, because the client's confirm/decline
  is a genuine, meaningful decision point (their NOA/NTP) — not a rubber
  stamp.
- **Who originates the project proposal.** The first version had the
  *client* submit a fully-specced project request (title, type, budget)
  for the PM to approve. That didn't match the actual business process,
  which shows the client originating nothing but a bare consultation
  request, with ALEK doing the assessment and proposal offline. It doesn't
  make sense for a client to specify a project type or a defensible budget
  before any assessment has happened — so the flow was flipped: PM
  authors the proposal, client confirms or declines it.
- **Payment proof upload, added then removed.** It was optional from the
  start, and added real complexity (multiple review states, extra approval
  functions, file storage) for something the "Record Payment" flow already
  fully covered on its own. It was removed in favor of Finance Admin
  recording payments directly from an offline-verified source, with a
  printable receipt as the paper trail instead.
- **Client accounts merged into company records.** Originally a client
  user and their company were two separate tables (`profiles` + `clients`),
  linked by a foreign key. Since the relationship was always 1-to-1 in
  practice, the company's fields were moved directly onto the client's own
  profile, removing a layer of indirection everywhere that used to need it.
- **Consultation request claiming.** With multiple PMs, an unassigned
  shared inbox risked two engineers contacting the same client. Claiming
  was added (first PM to mark a request "Contacted" locks it for everyone
  else), enforced at the database level so it can't be bypassed by an API
  call that skips the UI.
- **Public signup restricted to clients.** Anyone reaching the signup page
  could originally self-register as staff. Signup is now client-only by
  default; internal accounts (PM, Finance Admin) are created through a
  separate staff-only link that an existing Finance Admin shares directly
  when onboarding someone.

## 8. Changelog highlights

Smaller fixes made along the way, grouped by area:

- **Billing statement UI** — a client is no longer prompted to upload proof
  once a statement is already settled; status pills for paid/unpaid/
  partially-paid now have consistent color coding.
- **Navigation correctness** — the dashboard's "New Project" action now
  goes to the actual create form and is restricted to PMs; Finance Admin
  sees a "View Projects" link instead.
- **Billing request/type guards** *(from the era when billing requests
  still existed)* — a PM couldn't request billing against a closed project;
  billing type locked to "final" automatically once a project was marked
  completed.
- **Stale form data** — the "New Project Proposal" form now clears all
  fields every time it's opened, before applying any consultation-linked
  prefill, instead of only clearing after a successful submit.
- **Layout/spacing cleanup** — stat card padding and grid spacing were
  reduced site-wide after a CSS rule and a Bootstrap utility class were
  both fighting over the same cards, making them bulkier than intended.
- **Input validation** — billing/payment amounts, project cost, additional
  costs, and working days must now be valid, non-negative numbers (not just
  "not empty"); email and contact number go through basic shape-checking
  before save.
- **Project archiving simplified** — the manual "Archive Project" button
  was removed. A project's archived state is just its `status` being
  `Closed`, which already saves through the normal project edit form —
  so a separate archive action was redundant and has been dropped in
  favor of just setting status to Closed.
- **Proposal edit/withdraw** — a PM can edit or withdraw their own proposal
  while it's still pending; once the client has confirmed or declined it,
  neither action is offered.
- **User management page** — added a page listing every account with role
  and company link, letting Finance Admin change a user's role or company
  link, and hosting the staff-only signup link. (Email addresses aren't
  shown here — they live on the auth account, not the app-visible profile.)
- **Billing type field removed** — the `billing_type` dropdown
  (Mobilization/Progress/Final/Other) was dropped from the "Issue Billing
  Statement" form, the billing table, and the `billing` schema; a
  statement's amount and description are enough on their own.
- **Demo/reset tooling** — a seed script for demo data and a reset script
  that wipes business data while leaving accounts intact are available for
  testing and presentations; both went through a couple of ordering
  bugfixes (circular foreign keys between tables that reference each other,
  and dependent rows needing to be cleared before the rows they point to).

---

## 9. Contributing

Found a bug? Congratulations, you found a bug. 

![This is fine](https://media.giphy.com/media/NTur7XlVDUdqM/giphy.gif)

