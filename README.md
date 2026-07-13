# IM2 PROJECT

## ALEK Consultants — Project Management & Billing System

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

## 5. Database structure

See `ALEK_Consultants_ERD.pdf` for the full entity-relationship diagram.
Key tables:

- `profiles` — one row per user account, tied to `auth.users`, carries `role`
- `clients` — company records
- `project_requests` — client-submitted intake, reviewed by PM
- `projects` — the real, approved projects
- `billing_requests` — PM-submitted billing intake, reviewed by Finance Admin
- `billing` — the real, issued billing statements
- `payment_proofs` — client-submitted payment claims, reviewed by Finance Admin
- `payments` — the real, recorded payments
- `project_documents` — NOA, NTP, contracts, plans, reports, etc.

Six `security definer` functions are the only sanctioned way to move a
request into its "real" record:
`approve_project_request`, `reject_project_request`,
`approve_billing_request`, `reject_billing_request`,
`verify_payment_proof`, `reject_payment_proof`.
Each re-checks the caller's role before doing anything, so the approval
rule can't be bypassed by calling the table directly.

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
