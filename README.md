# IM2 PROJECT

# ALEK Consultants — Project Management & Billing System

A web app for **ALEK Consultants Inc.** that manages the full lifecycle of a
project: from a client's initial request, through PM approval and execution,
to billing and payment collection.

## 1. User roles

| Role | Can do |
|---|---|
| **Client** | Submit project requests, view their own projects and billing statements, upload proof of payment, view payment history |
| **Project Manager (PM)** | Review/approve project requests, create and manage projects, request billing statements |
| **Finance Admin** | Review/approve billing requests, issue billing statements, record payments, verify client-uploaded payment proofs, manage client records |

Roles are enforced at the database level via Supabase Row Level Security
(RLS) — a role can only see or modify the rows it's actually allowed to,
regardless of what the front end shows.

## 2. Core business process

The base process (client inquiry → proposal → NOA/NTP → billing → payment)
is unchanged from the original process design. What was added is an
**approval layer** in front of the two most sensitive actions in the system:
creating a Project, and issuing a Billing statement. Previously either could
be created directly by a single role with no review step; the current
system requires a request first, then a review, before the real record is
created.

## 3. The three workflows

### 3.1 Project request → approval → project

1. **Client** opens **Project Requests** and submits a request: title,
   location, project type, description, estimated budget, preferred start
   date. Status starts as `pending`.
2. **PM** opens **Incoming Project Requests**, reviews it, and clicks
   **Approve** or **Reject**.
3. Approving does **not** create the project automatically — it opens the
   **Create Project** form pre-filled with the request's details (a
   `fromRequestNotice` banner shows which request it came from). The PM
   fills in the remaining fields (contract amount, dates, financial admin)
   and submits.
4. Only at that point does a row exist in the `projects` table, linked back
   to the original request via `converted_project_id`.

### 3.2 Billing request → approval → billing statement

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

### 3.3 Payment → proof → verification

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
| Project Requests | Submit new requests, track status (`pending` → `under_review` → `approved`/`rejected`) |
| Billing Statements | View statements, upload proof of payment |
| Payments | View own payment history (read-only) |

### As Project Manager
| Screen | What happens |
|---|---|
| Dashboard | Own assigned projects |
| Incoming Project Requests | Approve/reject client requests |
| Create Project | Pre-filled form after approving a request |
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
- `email`
- `address`

### projects
The real, approved projects — only created after a `project_requests` row
is approved.

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
- `progress_percentage` — 0 to 100, drives the progress bar in the UI

### project_requests
The client's "application" for a new project, before it becomes real.

- `id` (PK)
- `client_id` (FK → clients.id) — who's requesting
- `requested_by` (FK → profiles.id) — which specific user submitted it
- `title`, `location`, `project_type`, `description`
- `estimated_budget`, `preferred_start_date`
- `status` — `pending` → `under_review` → `approved`/`rejected`
- `reviewed_by` (FK → profiles.id) — which PM reviewed it
- `review_notes` — PM's comments
- `converted_project_id` (FK → projects.id) — set once approved and
  turned into a real project; this is the link between "application" and
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
- `description`, `billing_type`, `date_issued`
- `balance_left` — auto-maintained by a trigger every time a payment lands
- `source_request_id` (FK → billing_requests.id) — traces this statement
  back to the request that produced it (null if Finance Admin issued it
  directly with no PM request behind it, e.g. a correction)

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
auth.users → profiles → clients → project_requests → projects
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
can submit `project_requests`, which — once approved — become real
`projects`; each project can generate `billing_requests`, which — once
approved — become real `billing` statements; each statement can receive
either a direct `payments` entry or a client-submitted `payment_proofs`
claim that, once verified, also produces a `payments` row.

Six `security definer` functions are the only sanctioned way to move a
request into its "real" record: `approve_project_request`,
`reject_project_request`, `approve_billing_request`,
`reject_billing_request`, `verify_payment_proof`, `reject_payment_proof`.
Each re-checks the caller's role before doing anything, so the approval
rule can't be bypassed by calling the underlying table directly.

## 6. Why the approval layer was added

The original spec allowed each role to create its own records directly (PM
creates projects, Finance Admin creates billing statements, client creates
payments). During development, this was identified as a gap: nothing
stopped a single role from creating a record with no review, and nothing
gave the client a structured way to request a project or verified their
payment claims. The request → review → approve pattern was added to close
that gap while keeping the same end result each role is responsible for in
the spec — the PM still creates the project, Finance Admin still issues the
statement — just with a review step in front of it.

