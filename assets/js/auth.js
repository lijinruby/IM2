const supabaseUrl = 'https://pmcyfsghrdzdrgummljv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtY3lmc2docmR6ZHJndW1tbGp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NDI4NjgsImV4cCI6MjA5ODIxODg2OH0.nt3qrcvHUjPZH3fmKFGEj1WNBYs28nFPJ9FWeh8F5SI';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

/**
 * Helper to show on-page messages
 * @param {string} text - The message to show
 * @param {string} type - 'error', 'success', or 'info'
 */
function showMessage(text, type = 'error') {
    const msgBox = document.getElementById('auth-message');
    if (!msgBox) return;

    msgBox.innerText = text;
    msgBox.className = `auth-message ${type}`;
}

async function protectPage() {
    const { data: { user } } = await _supabase.auth.getUser();
    const path = window.location.pathname;
    const isAuthPage = path.endsWith('index.html') || path.endsWith('signup.html') || path === '/' || path.endsWith('billing-monitoring/');

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
        const role = localStorage.getItem('userRole') || 'client';
        document.body.classList.add('role-' + role);
        const userTag = document.getElementById('userTag');
        if (userTag) userTag.innerText = role.toUpperCase();
    }
}

async function login() {
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    const btn = document.querySelector('button');

    if (!email || !password) {
        showMessage("Please enter your email and password.");
        return;
    }

    btn.innerText = "Authenticating...";
    btn.disabled = true;

    const { data, error } = await _supabase.auth.signInWithPassword({ email, password });

    if (error) { 
        showMessage(error.message, "error"); 
        btn.innerText = "Enter Portal";
        btn.disabled = false;
        return; 
    }

    const { data: profile } = await _supabase.from('profiles').select('role').eq('id', data.user.id).single();
    localStorage.setItem('userRole', profile?.role || 'client');
    window.location.href = 'views/dashboard.html';
}

async function signUp() {
    const fullName = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const role = document.getElementById('signup-role').value.toLowerCase();

    // 1. Perform the signup
    const { data, error } = await _supabase.auth.signUp({
        email, 
        password,
        options: { 
            data: { 
                full_name: fullName, 
                role: role 
            } 
        }
    });

    if (error) { 
        alert("Signup Error: " + error.message); 
        return; 
    }

    // 2. FORCE SIGNOUT: This prevents the auto-login session
    await _supabase.auth.signOut();

    // 3. Inform the user and redirect
    alert("Account Created! You can now sign in.");
    window.location.href = 'index.html'; // Redirect to your login page
}

async function logout() {
    await _supabase.auth.signOut();
    localStorage.clear();
    const prefix = window.location.pathname.includes('views/') ? '../' : '';
    window.location.href = prefix + 'index.html';
}

protectPage();