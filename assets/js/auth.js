/**
 * ALEK Consultants - Core Auth & UI Logic
 * Dependencies: Supabase JS, Bootstrap 5 (CSS), FontAwesome/Bootstrap Icons
 */

// 1. Supabase Configuration
const supabaseUrl = 'https://pmcyfsghrdzdrgummljv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtY3lmc2docmR6ZHJndW1tbGp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NDI4NjgsImV4cCI6MjA5ODIxODg2OH0.nt3qrcvHUjPZH3fmKFGEj1WNBYs28nFPJ9FWeh8F5SI';

// FIX: `supabase` (from the CDN script tag) is the *library*, not a client.
// Every page's inline script was calling supabase.auth.getUser() / supabase.from(...)
// on that library object, which has no .auth or .from — every DB call was failing.
// We create the real client, then overwrite the global `supabase` with it so every
// page's existing `supabase.from(...)` calls work without editing every file.
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);
window.supabase = _supabase;

/**
 * 2. UI Helper Functions
 */

// Display labels for each role, matching the actual job function:
//   admin  -> Finance Admin  (billing statements, payments, billing data)
//   pm     -> Project Manager (creates/updates project records, tracks status)
//   client -> Client         (read-only: own billing + payment history)
const ROLE_LABELS = { admin: 'Finance Admin', pm: 'Project Manager', client: 'Client' };
function normalizeRole(role) {
    const raw = (role || '').toString().trim().toLowerCase();
    if (!raw) return 'client';
    if (raw.includes('admin')) return 'admin';
    if (raw.includes('pm') || raw.includes('manager') || raw.includes('project')) return 'pm';
    if (raw.includes('client') || raw.includes('partner')) return 'client';
    return 'client';
}
function roleLabel(role) {
    return ROLE_LABELS[normalizeRole(role)] || role;
}

async function getCurrentRole() {
    const { data: { user } } = await _supabase.auth.getUser();
    if (!user) return 'client';

    const { data: profile, error } = await _supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    const role = normalizeRole(profile?.role || localStorage.getItem('userRole') || 'client');
    localStorage.setItem('userRole', role);
    return role;
}

async function enforceRole(allowedRoles = [], redirectUrl = 'dashboard.html') {
    const role = await getCurrentRole();
    if (!allowedRoles.includes(role)) {
        const prefix = window.location.pathname.includes('/views/') ? '' : '';
        window.location.href = prefix + redirectUrl;
        return false;
    }
    return true;
}

function showMessage(text, type = 'danger') {
    const msgBox = document.getElementById('auth-message');
    if (!msgBox) return;

    msgBox.innerText = text;
    const alertClass = type === 'error' ? 'danger' : type;
    msgBox.className = `alert alert-${alertClass} d-block animated fadeIn`;

    if (type === 'success') {
        setTimeout(() => { msgBox.className = 'd-none'; }, 5000);
    }
}

/**
 * 2b. Shared display helpers (status labels/badges, dates, file uploads)
 * Centralized here so every page — old and new — formats the same status
 * the same way instead of each re-inventing a switch statement.
 */
const PROJECT_STATUS_LABELS = {
    planning: 'Planning',
    mobilization: 'Mobilization',
    ongoing: 'Ongoing',
    on_hold: 'On Hold', // legacy value from before the six-state spec statuses
    for_review: 'For Review',
    completed: 'Completed',
    closed: 'Closed'
};
function statusLabel(status) {
    if (!status) return 'Ongoing';
    return PROJECT_STATUS_LABELS[status] || status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const REQUEST_STATUS_LABELS = {
    pending: 'Pending',
    under_review: 'Under Review',
    approved: 'Approved',
    rejected: 'Rejected',
    verified: 'Verified',
    // project_requests (proposals), as of the v3 flip: PM authors, client confirms.
    confirmed: 'Confirmed',
    declined: 'Declined',
    // consultation_requests
    new: 'New',
    contacted: 'Contacted',
    closed: 'Closed'
};
function requestStatusLabel(status) {
    return REQUEST_STATUS_LABELS[status] || (status || '').replace(/_/g, ' ');
}
function requestBadgeClass(status) {
    return 'badge-' + (status || 'pending');
}

function fmtDate(d) {
    return d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}
function fmtDateTime(d) {
    return d ? new Date(d).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

// Upload a File object to a private Supabase Storage bucket under a given
// folder (project id / billing id), returning the storage path to save in
// the matching index table (project_documents / payment_proofs).
async function uploadToBucket(bucket, folder, file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${folder}/${Date.now()}_${safeName}`;
    const { error } = await _supabase.storage.from(bucket).upload(path, file, { upsert: false });
    if (error) throw error;
    return path;
}

// Open a private file in a new tab via a short-lived signed URL.
async function openFromBucket(bucket, path) {
    const { data, error } = await _supabase.storage.from(bucket).createSignedUrl(path, 120);
    if (error) {
        alert('Could not open file: ' + error.message);
        return;
    }
    window.open(data.signedUrl, '_blank');
}

/**
 * 3. Sidebar Logic
 * FIX: pages used to ALSO attach their own click listener on #sidebarToggle,
 * so one click fired two toggles and visually cancelled itself out.
 * This is now the ONLY place that wires up the toggle button.
 */
function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');

    if (!sidebar || !toggleBtn) return;

    const isCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
    if (isCollapsed) sidebar.classList.add('collapsed');

    toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
    });
}

/**
 * 4. Authentication Logic
 */

// Protect pages from unauthorized access, and keep the role badge in sync
// with the database (not just whatever was cached at login time).
async function protectPage() {
    const { data: { user } } = await _supabase.auth.getUser();
    const path = window.location.pathname;

    const isAuthPage = path.endsWith('index.html') || path.endsWith('signup.html') || path === '/' || path.includes('/billing-monitoring/index.html');

    if (!user && !isAuthPage) {
        const prefix = path.includes('views/') ? '../' : '';
        window.location.href = prefix + 'index.html';
        return;
    }

    if (user) {
        if (isAuthPage) {
            window.location.href = 'views/dashboard.html';
            return;
        }

        const role = await getCurrentRole();
        document.body.classList.remove('role-loading', 'role-admin', 'role-pm', 'role-client');
        document.body.classList.add('role-' + role);

        const userTag = document.getElementById('userTag');
        if (userTag) {
            if (role === 'admin') userTag.className = "badge rounded-pill bg-danger";
            else if (role === 'pm') userTag.className = "badge rounded-pill bg-primary";
            else userTag.className = "badge rounded-pill bg-success";
            userTag.innerText = roleLabel(role).toUpperCase();
        }

        const roleBadge = document.getElementById('userRoleBadge');
        if (roleBadge) roleBadge.innerText = roleLabel(role);
    }
}


// Login Process
async function login() {
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    const btn = document.querySelector('button[onclick="login()"]');

    if (!email || !password) {
        showMessage("Please enter both email and password.", "warning");
        return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> Authenticating...`;
    btn.disabled = true;

    const { data, error } = await _supabase.auth.signInWithPassword({ email, password });

    if (error) {
        showMessage(error.message, "danger");
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
    }

    const { data: profile } = await _supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single();

    localStorage.setItem('userRole', normalizeRole(profile?.role || 'client'));
    window.location.href = 'views/dashboard.html';
}

// Signup Process
// FIX: the role dropdown used to let anyone register as "Finance Admin".
// The dropdown itself is now client/PM only (see signup.html), and the
// database trigger (handle_new_user) also refuses to honor role: 'admin'
// even if someone bypasses the UI and calls the API directly.
async function signUp() {
    const fullName = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const roleEl = document.getElementById('signup-role');
    const role = roleEl ? roleEl.value : 'client';
    const btn = document.querySelector('button[onclick="signUp()"]');

    // Client account = Company account: for a client signup, the company
    // fields below ARE the client record — no separate "Finance Admin
    // creates the client" step exists anymore.
    const companyNameEl = document.getElementById('signup-company-name');
    const companyContactEl = document.getElementById('signup-company-contact');
    const companyAddressEl = document.getElementById('signup-company-address');
    const companyName = companyNameEl ? companyNameEl.value.trim() : '';
    const companyContact = companyContactEl ? companyContactEl.value.trim() : '';
    const companyAddress = companyAddressEl ? companyAddressEl.value.trim() : '';

    if (!fullName || !email || !password) {
        showMessage("Please fill in all fields.", "warning");
        return;
    }

    if (role === 'client' && !companyName) {
        showMessage("Please enter your company name.", "warning");
        return;
    }

    if (companyContact && !isValidPhone(companyContact)) {
        showMessage("Please enter a valid contact number.", "warning");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Creating Account...`;

    const { data, error } = await _supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name: fullName,
                role: role,
                company_name: role === 'client' ? companyName : null,
                contact_number: role === 'client' ? companyContact : null,
                address: role === 'client' ? companyAddress : null,
                email: email
            }
        }
    });

    if (error) {
        showMessage(error.message, "danger");
        btn.disabled = false;
        btn.innerText = "Register Account";
        return;
    }

    await _supabase.auth.signOut();
    alert("Account created successfully! Please sign in.");
    window.location.href = 'index.html';
}

// Logout Process
async function logout() {
    await _supabase.auth.signOut();
    localStorage.clear();
    const path = window.location.pathname;
    const prefix = path.includes('views/') ? '../' : '';
    window.location.href = prefix + 'index.html';
}

/**
 * 5. Initialization
 */
document.addEventListener('DOMContentLoaded', () => {
    protectPage();
    initSidebar();
});

// Password visibility toggle
document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('togglePassword');
    const pwd = document.getElementById('password-input');

    if (toggle && pwd) {
        toggle.addEventListener('click', (e) => {
            e.preventDefault();
            if (pwd.type === 'password') {
                pwd.type = 'text';
                toggle.innerHTML = '<i class="bi bi-eye-slash"></i>';
            } else {
                pwd.type = 'password';
                toggle.innerHTML = '<i class="bi bi-eye"></i>';
            }
        });
    }
});

// Signup: toggle visibility and submit on Enter inside password field
document.addEventListener('DOMContentLoaded', () => {
    const toggleS = document.getElementById('toggleSignupPassword');
    const pwdS = document.getElementById('signup-password');
    const signupBtn = document.querySelector('button[onclick="signUp()"]');

    if (toggleS && pwdS) {
        toggleS.addEventListener('click', (e) => {
            e.preventDefault();
            if (pwdS.type === 'password') {
                pwdS.type = 'text';
                toggleS.innerHTML = '<i class="bi bi-eye-slash"></i>';
            } else {
                pwdS.type = 'password';
                toggleS.innerHTML = '<i class="bi bi-eye"></i>';
            }
        });
    }

    if (pwdS) {
        pwdS.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (signupBtn) signupBtn.click();
                else signUp();
            }
        });
    }
});
// ----------------------------------------------------------------------------
// Shared input validation helpers.
// Kept loose on purpose (basic shape-checking, not strict RFC validation) —
// the goal is catching obvious typos (missing @, letters in a phone number),
// not rejecting every legitimately unusual but valid input.
// ----------------------------------------------------------------------------
function isValidEmail(value) {
    if (!value) return true; // empty is allowed where the field is optional
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPhone(value) {
    if (!value) return true; // empty is allowed where the field is optional
    // Digits, spaces, +, -, () only, at least 7 digits total.
    const cleaned = value.trim();
    if (!/^[0-9+\-()\s]+$/.test(cleaned)) return false;
    return (cleaned.match(/[0-9]/g) || []).length >= 7;
}
