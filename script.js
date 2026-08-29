// ─── STATE ──────────────────────────────────────────
let allJournals = [],
    allFaculty = [],
    allNews = [],
    allProgrammes = [];

let siteSettings = {
    submission_deadline: null,   // e.g. '2026-07-30' — set by admin
    submission_email: 'kjsss@kasu.edu.ng',
    site_logo_url: null
};

let currentUser = null; // the logged-in author's session.user, or null
let currentUserRole = null; // 'user' (author), 'reviewer', or 'admin' — from profiles.role

// ─── TOAST ──────────────────────────────────────────
function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast toast-${type}`;
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 5000);
}

// ─── INIT ────────────────────────────────────────────
async function init() {
    try {
        await initSupabaseWithRetry();
        console.log('✅ Supabase initialized');

        refreshAllData();
        fetchSiteSettings();
        initFileUploads();

        // Track auth state for the Submit page's login gate
        const { data: sessionData } = await db.auth.getSession();
        currentUser = sessionData.session ? sessionData.session.user : null;
        await refreshCurrentUserRole();

        db.auth.onAuthStateChange(async (_event, session) => {
            currentUser = session ? session.user : null;
            await refreshCurrentUserRole();
            renderSubmitPageAuthState();
        });

        console.log('✅ Site ready!');
    } catch (e) {
        console.error('❌ Init error:', e);
        showPersistentError('⚠️ ' + (e.message || 'Could not connect to the server. Please refresh the page.'));
    }
}

document.addEventListener('DOMContentLoaded', init);

// ─── PAGE NAVIGATION ─────────────────────────────────
function showPage(page) {
    // Reviewers and admins don't use the author Submit page — route them
    // to the view appropriate for their actual role instead.
    if (page === 'submit' && currentUserRole === 'reviewer') {
        page = 'reviewer';
    }
    if (page === 'submit' && currentUserRole === 'admin') {
        page = 'admin-notice';
    }

    // Clean the ?article= param out of the URL when navigating anywhere
    // other than the article page itself, so links elsewhere stay tidy.
    if (page !== 'article') {
        const url = new URL(window.location.href);
        if (url.searchParams.has('article')) {
            url.searchParams.delete('article');
            window.history.replaceState({}, '', url);
        }
    }

    document.querySelectorAll('.page-content').forEach(el => el.classList.remove('active'));
    const t = document.getElementById(`page-${page}`);
    if (t) t.classList.add('active');
    document.querySelectorAll('#mainNav a').forEach(a => a.classList.remove('active'));
    const n = document.querySelector(`#mainNav a[data-page="${page}"]`);
    if (n) n.classList.add('active');
    document.getElementById('mainNav').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const bc = document.getElementById('breadcrumbCurrent');
    if (bc) bc.textContent = page.charAt(0).toUpperCase() + page.slice(1);

    if (page === 'submit') {
        renderSubmitPageAuthState();
    }
    if (page === 'reviewer') {
        renderReviewerPage();
    }
    if (page === 'admin-notice') {
        renderAdminNoticePage();
    }
    if (page === 'editorial-board') {
        renderEditorialBoard();
    }
}

function toggleMobileMenu() {
    document.getElementById('mainNav').classList.toggle('open');
}

function togglePanel(header) {
    const body = header.nextElementSibling;
    if (body.style.display === 'none' || !body.style.display) {
        body.style.display = 'block';
        header.querySelector('span:last-child').textContent = '▼';
    } else {
        body.style.display = 'none';
        header.querySelector('span:last-child').textContent = '›';
    }
}

// ─── AUTH: LOGIN / REGISTER / LOGOUT ─────────────────

function switchAuthTab(tab) {
    const loginForm = document.getElementById('authLoginForm');
    const registerForm = document.getElementById('authRegisterForm');
    const loginBtn = document.getElementById('authTabLoginBtn');
    const registerBtn = document.getElementById('authTabRegisterBtn');

    if (tab === 'login') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        loginBtn.classList.add('active');
        registerBtn.classList.remove('active');
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        registerBtn.classList.add('active');
        loginBtn.classList.remove('active');
    }
}

async function authLogin(e) {
    e.preventDefault();
    const errEl = document.getElementById('authLoginError');
    errEl.style.display = 'none';
    try {
        if (!db) await initSupabaseWithRetry(8, 250);
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const { data, error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
        currentUser = data.user;
        await refreshCurrentUserRole();
        showToast('Logged in!', 'success');
        document.getElementById('authLoginForm').reset();
        renderSubmitPageAuthState();
    } catch (err) {
        errEl.textContent = err.message || 'Login failed. Check your email and password.';
        errEl.style.display = 'block';
    }
}

async function authRegister(e) {
    e.preventDefault();
    const errEl = document.getElementById('authRegisterError');
    const successEl = document.getElementById('authRegisterSuccess');
    errEl.style.display = 'none';
    successEl.style.display = 'none';
    try {
        if (!db) await initSupabaseWithRetry(8, 250);
        const fullName = document.getElementById('registerName').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;

        const { data, error } = await db.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } }
        });
        if (error) throw error;

        // If email confirmation is required, there's no session yet — tell
        // the user to check their inbox rather than assuming they're logged in.
        if (data.session) {
            currentUser = data.user;
            await refreshCurrentUserRole();
            showToast('Account created — you\'re logged in!', 'success');
            document.getElementById('authRegisterForm').reset();
            renderSubmitPageAuthState();
        } else {
            successEl.textContent = 'Account created! Please check your email to confirm your address, then log in.';
            successEl.style.display = 'block';
            document.getElementById('authRegisterForm').reset();
        }
    } catch (err) {
        errEl.textContent = err.message || 'Could not create account.';
        errEl.style.display = 'block';
    }
}

async function authLogout() {
    try {
        await db.auth.signOut();
        currentUser = null;
        currentUserRole = null;
        showToast('Logged out', 'info');
        renderSubmitPageAuthState();
    } catch (e) {
        showToast('Error logging out', 'error');
    }
}

// Fetches profiles.role for the current session so the site can route
// authors vs reviewers to the right dashboard after login.
async function refreshCurrentUserRole() {
    if (!currentUser) { currentUserRole = null; return; }
    try {
        const { data, error } = await db.from('profiles').select('role').eq('id', currentUser.id).single();
        if (error) throw error;
        currentUserRole = data.role;
    } catch (e) {
        console.error('Could not load user role:', e);
        currentUserRole = 'user'; // safe fallback — treat as an ordinary author
    }
}

// Loads and renders manuscripts assigned to the logged-in reviewer, each
// with a review form (recommendation + comments). Uses the blind view,
// which never includes author name or email.
async function renderReviewerPage() {
    const emailEl = document.getElementById('reviewerUserEmail');
    if (emailEl && currentUser) emailEl.textContent = currentUser.email;

    // Populate the reviewer's own credential card
    if (currentUser) {
        try {
            const { data: profile } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
            const nameEl = document.getElementById('reviewerNameDisplay');
            const avatarEl = document.getElementById('reviewerAvatarDisplay');
            if (nameEl) nameEl.textContent = profile.full_name || currentUser.email;
            if (avatarEl) {
                avatarEl.innerHTML = profile.avatar_url
                    ? `<img src="${profile.avatar_url}" alt="" style="width:100%;height:100%;object-fit:cover;">`
                    : initialsFromName(profile.full_name || currentUser.email);
            }

            const statStripEl = document.getElementById('reviewerStatStrip');
            if (statStripEl) {
                const { data: assignments } = await db.from('submission_reviewers').select('status').eq('reviewer_id', currentUser.id);
                const completed = (assignments || []).filter(a => a.status === 'completed').length;
                const pending = (assignments || []).filter(a => a.status === 'assigned').length;
                statStripEl.innerHTML = renderStatStrip([
                    { value: pending, label: 'Pending Review' },
                    { value: completed, label: 'Completed' },
                ]);
            }
        } catch (e) {
            console.error('Could not load reviewer profile:', e);
        }
    }

    const container = document.getElementById('reviewerAssignmentsList');
    if (!container || !currentUser) return;
    container.innerHTML = '<div class="loading"><div class="loading-spinner"></div>Loading...</div>';

    try {
        const { data, error } = await db.from('reviewer_submission_view').select('*').order('created_at', { ascending: false });
        if (error) throw error;

        if (!data || !data.length) {
            container.innerHTML = '<div style="background:white;border-radius:12px;padding:2rem;text-align:center;color:var(--text-muted);">No manuscripts assigned to you yet.</div>';
            return;
        }

        // Fetch this reviewer's own submitted reviews, to show which
        // assignments are already completed.
        const { data: myReviews } = await db.from('reviews').select('submission_id').eq('reviewer_id', currentUser.id);
        const reviewedIds = new Set((myReviews || []).map(r => r.submission_id));

        container.innerHTML = data.map(s => {
            const alreadyReviewed = reviewedIds.has(s.id);
            return `
            <div class="assignment-card">
                <h3>${s.title}</h3>
                <div class="assignment-meta">${s.research_area || ''} · Submitted ${formatDate(s.created_at)}</div>
                <p class="assignment-field"><strong>Abstract:</strong> ${s.abstract}</p>
                <p class="assignment-field"><strong>Keywords:</strong> ${s.keywords || '—'}</p>
                <p class="assignment-field"><strong>AI Tool Disclosure:</strong> ${s.ai_tools_disclosure || 'None stated'}</p>
                ${s.manuscript_path ? `<button type="button" class="btn-outline-dark" style="font-size:12px;padding:6px 14px;margin-bottom:0.5rem;" onclick="downloadManuscriptAsReviewer('${s.manuscript_path}')">📄 Download Manuscript</button>` : ''}

                ${alreadyReviewed
                    ? `<div class="review-complete-banner" style="margin-top:1rem;">✅ You've already submitted your review for this manuscript.</div>`
                    : `<form onsubmit="submitReview(event, '${s.id}')" class="review-form">
                        <div class="field-group">
                            <label>Recommendation *</label>
                            <select required id="reviewRec_${s.id}">
                                <option value="">Select…</option>
                                <option value="accept">Accept</option>
                                <option value="minor_revisions">Minor Revisions</option>
                                <option value="major_revisions">Major Revisions</option>
                                <option value="reject">Reject</option>
                            </select>
                        </div>
                        <div class="field-group">
                            <label>Comments to Editor (confidential)</label>
                            <textarea id="reviewEditorComments_${s.id}" rows="2"></textarea>
                        </div>
                        <div class="field-group">
                            <label>Comments to Author</label>
                            <textarea id="reviewAuthorComments_${s.id}" rows="2"></textarea>
                        </div>
                        <button type="submit" class="btn-primary" style="font-size:13px;padding:8px 18px;">Submit Review</button>
                    </form>`
                }
            </div>`;
        }).join('');
    } catch (e) {
        console.error('Error loading reviewer assignments:', e);
        container.innerHTML = '<p style="color:#dc2626;">Could not load your assignments. Please refresh.</p>';
    }
}

// Quick profile edit for reviewers (name, affiliation, expertise, bio) —
// a lightweight prompt-based flow rather than a full form, since reviewers
// only need to set this occasionally.
async function editReviewerProfile() {
    if (!currentUser) return;
    try {
        const { data: profile } = await db.from('profiles').select('*').eq('id', currentUser.id).single();

        const fullName = prompt('Full name:', profile.full_name || '');
        if (fullName === null) return;
        const affiliation = prompt('Institutional affiliation:', profile.affiliation || '');
        if (affiliation === null) return;
        const expertise = prompt('Areas of research expertise (comma separated):', profile.expertise || '');
        if (expertise === null) return;
        const bio = prompt('Short bio:', profile.bio || '');
        if (bio === null) return;

        const { error } = await db.from('profiles').update({
            full_name: fullName,
            affiliation: affiliation || null,
            expertise: expertise || null,
            bio: bio || null
        }).eq('id', currentUser.id);
        if (error) throw error;

        showToast('Profile updated!', 'success');
        renderReviewerPage();
    } catch (e) {
        showToast(e.message || 'Error updating profile', 'error');
    }
}

async function downloadManuscriptAsReviewer(path) {
    try {
        const { data, error } = await db.storage.from('manuscripts').createSignedUrl(path, 60);
        if (error) throw error;
        window.open(data.signedUrl, '_blank');
    } catch (e) {
        showToast('Error generating download link', 'error');
    }
}

async function submitReview(e, submissionId) {
    e.preventDefault();
    try {
        const recommendation = document.getElementById(`reviewRec_${submissionId}`).value;
        const comments_to_editor = document.getElementById(`reviewEditorComments_${submissionId}`).value || null;
        const comments_to_author = document.getElementById(`reviewAuthorComments_${submissionId}`).value || null;

        const { error } = await db.from('reviews').insert({
            submission_id: submissionId,
            reviewer_id: currentUser.id,
            recommendation,
            comments_to_editor,
            comments_to_author
        });
        if (error) throw error;

        showToast('Review submitted — thank you!', 'success');
        renderReviewerPage();
    } catch (err) {
        showToast(err.message || 'Error submitting review', 'error');
    }
}

// Shows the login/register tabs if logged out, or the submission form +
// "My Submissions" list if logged in. Called on init, on auth changes,
// and whenever the Submit page is opened.
function renderSubmitPageAuthState() {
    const gate = document.getElementById('authGateContainer');
    const authed = document.getElementById('authedSubmitContainer');
    if (!gate || !authed) return; // not on the submit page yet

    // Reviewers don't use the author submit flow at all — bounce them
    // straight to their own dashboard.
    if (currentUser && currentUserRole === 'reviewer') {
        showPage('reviewer');
        return;
    }
    // Admin accounts shouldn't be treated as authors either — send them
    // to a short notice pointing at the real Admin Dashboard.
    if (currentUser && currentUserRole === 'admin') {
        showPage('admin-notice');
        return;
    }

    if (currentUser) {
        gate.style.display = 'none';
        authed.style.display = 'block';
        const emailEl = document.getElementById('authedUserEmail');
        if (emailEl) emailEl.textContent = currentUser.email;
        loadMyProfile();
        loadMySubmissions();
    } else {
        gate.style.display = 'block';
        authed.style.display = 'none';
    }
}

// Shown when an admin account is logged into the public site — admins
// manage the journal through admin.html, not the author/reviewer portal.
function renderAdminNoticePage() {
    const emailEl = document.getElementById('adminNoticeUserEmail');
    if (emailEl && currentUser) emailEl.textContent = currentUser.email;
}

// Loads and renders the logged-in author's own submissions. RLS already
// restricts this to their rows, but filtering explicitly keeps the query
// intent clear.
async function loadMySubmissions() {
    const container = document.getElementById('mySubmissionsList');
    if (!container || !currentUser) return;
    try {
        const { data, error } = await db.from('submissions')
            .select('*')
            .eq('submitter_id', currentUser.id)
            .order('created_at', { ascending: false });
        if (error) throw error;

        if (!data || !data.length) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:14px;">You haven\'t submitted any manuscripts yet.</p>';
            return;
        }

        const statusLabels = {
            pending: 'Pending Review',
            in_review: 'In Review',
            accepted: 'Accepted',
            rejected: 'Rejected'
        };

        container.innerHTML = data.map(s => `
            <div class="submission-item">
                <div>
                    <div class="title">${s.title}</div>
                    <div class="meta">Submitted ${formatDate(s.created_at)}${s.research_area ? ' · ' + s.research_area : ''}</div>
                </div>
                <span class="status-pill status-${s.status}">${statusLabels[s.status] || s.status}</span>
            </div>
        `).join('');
    } catch (e) {
        console.error('Error loading my submissions:', e);
        container.innerHTML = '<p style="color:#dc2626;font-size:14px;">Could not load your submissions. Please refresh.</p>';
    }
}

// ─── MY PROFILE (edit + display) ─────────────────────

function toggleProfileEdit() {
    const viewMode = document.getElementById('profileViewMode');
    const editForm = document.getElementById('profileEditForm');
    const isEditing = editForm.style.display !== 'none';
    if (isEditing) {
        editForm.style.display = 'none';
        viewMode.style.display = 'block';
    } else {
        viewMode.style.display = 'none';
        editForm.style.display = 'block';
    }
}

function initialsFromName(name) {
    if (!name) return '?';
    return name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

// Renders a row of stat cells with thin dividers between them —
// the "transcript line" signature element shared by author and
// reviewer profile cards.
function renderStatStrip(cells) {
    return cells.map(c => `
        <div class="stat-cell">
            <div class="stat-value">${c.value}</div>
            <div class="stat-label">${c.label}</div>
        </div>
    `).join('');
}

// Loads the logged-in user's profile row and populates both the
// read-only display and the edit form.
async function loadMyProfile() {
    if (!currentUser) return;
    try {
        const { data, error } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
        if (error) throw error;

        const nameEl = document.getElementById('profileNameDisplay');
        const affEl = document.getElementById('profileAffiliationDisplay');
        const orcidEl = document.getElementById('profileOrcidDisplay');
        const bioEl = document.getElementById('profileBioDisplay');
        const avatarEl = document.getElementById('profileAvatarDisplay');

        if (nameEl) nameEl.textContent = data.full_name || 'Add your name — click Edit Profile';
        if (affEl) affEl.textContent = data.affiliation || '';
        if (orcidEl) orcidEl.textContent = data.orcid ? `ORCID ${data.orcid}` : '';
        if (bioEl) bioEl.textContent = data.bio || '';
        if (avatarEl) {
            avatarEl.innerHTML = data.avatar_url
                ? `<img src="${data.avatar_url}" alt="${data.full_name || ''}" style="width:100%;height:100%;object-fit:cover;">`
                : initialsFromName(data.full_name || currentUser.email);
        }

        // Stat strip: how many of this author's submissions are in each state
        const statStripEl = document.getElementById('profileStatStrip');
        if (statStripEl) {
            try {
                const { data: subs } = await db.from('submissions').select('status').eq('submitter_id', currentUser.id);
                const counts = { pending: 0, in_review: 0, accepted: 0, rejected: 0 };
                (subs || []).forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });
                const { count: publishedCount } = await db.from('journals').select('*', { count: 'exact', head: true }).eq('submitter_id', currentUser.id);
                statStripEl.innerHTML = renderStatStrip([
                    { value: counts.pending, label: 'Pending' },
                    { value: counts.in_review, label: 'In Review' },
                    { value: counts.accepted, label: 'Accepted' },
                    { value: publishedCount || 0, label: 'Published' },
                ]);
            } catch (statErr) {
                console.error('Could not load profile stats:', statErr);
            }
        }

        // Pre-fill the edit form too
        const fullNameInput = document.getElementById('profileFullName');
        const affInput = document.getElementById('profileAffiliation');
        const orcidInput = document.getElementById('profileOrcid');
        const bioInput = document.getElementById('profileBio');
        const avatarUrlInput = document.getElementById('profileAvatarUrl');
        if (fullNameInput) fullNameInput.value = data.full_name || '';
        if (affInput) affInput.value = data.affiliation || '';
        if (orcidInput) orcidInput.value = data.orcid || '';
        if (bioInput) bioInput.value = data.bio || '';
        if (avatarUrlInput) avatarUrlInput.value = data.avatar_url || '';

        // Pre-fill the "Author Name" field on the submission form too,
        // so returning authors don't have to retype it every time.
        const subAuthorField = document.getElementById('subAuthorFull');
        if (subAuthorField && !subAuthorField.value && data.full_name) {
            subAuthorField.value = data.full_name;
        }
    } catch (e) {
        console.error('Error loading profile:', e);
    }
}

async function saveMyProfile(e) {
    e.preventDefault();
    if (!currentUser) return;
    try {
        const updates = {
            full_name: document.getElementById('profileFullName').value,
            affiliation: document.getElementById('profileAffiliation').value || null,
            orcid: document.getElementById('profileOrcid').value || null,
            bio: document.getElementById('profileBio').value || null,
            avatar_url: document.getElementById('profileAvatarUrl').value || null,
        };
        const { error } = await db.from('profiles').update(updates).eq('id', currentUser.id);
        if (error) throw error;
        showToast('Profile saved!', 'success');
        toggleProfileEdit();
        loadMyProfile();
    } catch (err) {
        showToast(err.message || 'Error saving profile', 'error');
    }
}

// ─── PUBLIC AUTHOR PAGE ───────────────────────────────
// Shows a public profile (name, affiliation, bio, ORCID) plus every
// published journal article linked to that author, via the
// author_public_profiles view (which deliberately excludes email).
async function showAuthorPage(authorId) {
    showPage('author');
    const nameEl = document.getElementById('authorPageName');
    const affEl = document.getElementById('authorPageAffiliation');
    const orcidEl = document.getElementById('authorPageOrcid');
    const bioEl = document.getElementById('authorPageBio');
    const avatarEl = document.getElementById('authorPageAvatar');
    const journalsEl = document.getElementById('authorPageJournals');

    if (nameEl) nameEl.textContent = 'Loading…';
    if (journalsEl) journalsEl.innerHTML = '<div class="loading"><div class="loading-spinner"></div>Loading...</div>';

    try {
        const [{ data: profile, error: profErr }, { data: journals, error: jErr }] = await Promise.all([
            db.from('author_public_profiles').select('*').eq('id', authorId).single(),
            db.from('journals').select('*').eq('submitter_id', authorId).order('year', { ascending: false })
        ]);
        if (profErr) throw profErr;

        if (nameEl) nameEl.textContent = profile.full_name || 'Author';
        if (affEl) affEl.textContent = profile.affiliation || '';
        if (orcidEl) orcidEl.textContent = profile.orcid ? `ORCID: ${profile.orcid}` : '';
        if (bioEl) bioEl.textContent = profile.bio || '';
        if (avatarEl) {
            avatarEl.innerHTML = profile.avatar_url
                ? `<img src="${profile.avatar_url}" alt="${profile.full_name || ''}" style="width:100%;height:100%;object-fit:cover;">`
                : initialsFromName(profile.full_name);
        }

        if (jErr) throw jErr;
        journalsEl.innerHTML = (journals && journals.length)
            ? journals.map(renderJournalCard).join('')
            : '<p style="text-align:center;color:var(--text-muted);padding:2rem;">No published articles yet.</p>';
    } catch (e) {
        console.error('Error loading author page:', e);
        if (nameEl) nameEl.textContent = 'Author not found';
        if (journalsEl) journalsEl.innerHTML = '';
    }
}

// ─── DATA FETCHING ──────────────────────────────────
// fetchErrors tracks which sections failed to load, so the render
// functions can show a "Retry" button instead of leaving the
// "Loading..." spinner on screen forever.
let fetchErrors = { journals: false, faculty: false, news: false, programmes: false };

async function fetchJournals() {
    try {
        const { data, error } = await withTimeout(db.from('journals').select('*').order('year', { ascending: false }));
        if (error) throw error;
        allJournals = data || [];
        fetchErrors.journals = false;
        return allJournals;
    } catch (e) { console.error('Error fetching journals:', e); fetchErrors.journals = true; return []; }
}

async function fetchFaculty() {
    try {
        const { data, error } = await withTimeout(db.from('faculty').select('*').order('display_order', { ascending: true }));
        if (error) throw error;
        allFaculty = data || [];
        fetchErrors.faculty = false;
        return allFaculty;
    } catch (e) { console.error('Error fetching faculty:', e); fetchErrors.faculty = true; return []; }
}

async function fetchNews() {
    try {
        const { data, error } = await withTimeout(db.from('news_events').select('*').order('date', { ascending: false }));
        if (error) throw error;
        allNews = data || [];
        fetchErrors.news = false;
        return allNews;
    } catch (e) { console.error('Error fetching news:', e); fetchErrors.news = true; return []; }
}

async function fetchProgrammes() {
    try {
        const { data, error } = await withTimeout(db.from('programmes').select('*').order('level', { ascending: true }));
        if (error) throw error;
        allProgrammes = data || [];
        fetchErrors.programmes = false;
        return allProgrammes;
    } catch (e) { console.error('Error fetching programmes:', e); fetchErrors.programmes = true; return []; }
}

async function refreshAllData() {
    await Promise.all([fetchJournals(), fetchFaculty(), fetchNews(), fetchProgrammes()]);
    try { renderHomePage(); } catch (e) { console.error('renderHomePage failed:', e); }
    try { renderAllPages(); } catch (e) { console.error('renderAllPages failed:', e); }

    // If the page was opened directly at a shared article link
    // (e.g. index.html?article=some-slug), open straight to it.
    const params = new URLSearchParams(window.location.search);
    const sharedSlug = params.get('article');
    if (sharedSlug) {
        showPage('article');
        loadArticlePage(sharedSlug);
    }
}

// Retries a single section (called from the "Retry" button rendered
// in place of a section that failed to load) without re-fetching
// everything else.
async function retrySection(type) {
    showToast('Retrying…', 'info');
    if (type === 'journals') await fetchJournals();
    if (type === 'faculty') await fetchFaculty();
    if (type === 'news') await fetchNews();
    if (type === 'programmes') await fetchProgrammes();
    renderHomePage();
    renderAllPages();
}

// Renders a list into a container, or an error state with a Retry
// button if that section's fetch failed, or an empty-state message
// if the fetch succeeded but returned nothing.
function renderSectionOrError(containerId, items, renderFn, hasError, emptyMsg, retryType) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (hasError) {
        el.innerHTML = `<div style="text-align:center;padding:2rem;color:#dc2626;">
            ⚠️ Couldn't load this content.
            <button class="btn-outline-dark" style="margin-left:8px;" onclick="retrySection('${retryType}')">Retry</button>
        </div>`;
        return;
    }
    try {
        const html = items.map(item => {
            try {
                return renderFn(item);
            } catch (itemErr) {
                console.error(`Skipped a broken record in ${containerId}:`, itemErr, item);
                return '';
            }
        }).join('');
        el.innerHTML = html || `<p style="text-align:center;color:var(--text-muted);padding:2rem;">${emptyMsg}</p>`;
    } catch (sectionErr) {
        console.error(`Error rendering ${containerId}:`, sectionErr);
        el.innerHTML = `<div style="text-align:center;padding:2rem;color:#dc2626;">
            ⚠️ Something went wrong displaying this content.
            <button class="btn-outline-dark" style="margin-left:8px;" onclick="retrySection('${retryType}')">Retry</button>
        </div>`;
    }
}

// ─── SITE SETTINGS (deadline / submission email) ───
async function fetchSiteSettings() {
    try {
        const { data, error } = await db.from('settings')
            .select('*')
            .in('key', ['submission_deadline', 'submission_email', 'site_logo_url']);
        if (error) throw error;
        (data || []).forEach(row => {
            if (row.key === 'submission_deadline') siteSettings.submission_deadline = row.value;
            if (row.key === 'submission_email') siteSettings.submission_email = row.value;
            if (row.key === 'site_logo_url') siteSettings.site_logo_url = row.value;
        });
    } catch (e) {
        console.warn('Could not load site settings, using defaults:', e.message);
    } finally {
        renderSubmissionInfo();
        applySiteLogo();
    }
}

function applySiteLogo() {
    const logoEl = document.getElementById('brandLogo');
    if (!logoEl) return;
    if (siteSettings.site_logo_url) {
        logoEl.innerHTML = `<img src="${siteSettings.site_logo_url}" alt="Department of Sociology logo" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    }
}

function renderSubmissionInfo() {
    const email = siteSettings.submission_email || 'kjsss@kasu.edu.ng';
    const deadlineRaw = siteSettings.submission_deadline;
    let deadlineLabel = 'to be announced';
    let isPast = false;

    if (deadlineRaw) {
        const d = new Date(deadlineRaw + 'T23:59:59');
        if (!isNaN(d.getTime())) {
            deadlineLabel = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            isPast = d.getTime() < Date.now();
        }
    }

    ['quickDeadlineText', 'fullDeadlineText'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = deadlineLabel;
    });
    ['quickEmailText', 'fullEmailText'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = email;
    });

    const quickBanner = document.getElementById('quickDeadlineBanner');
    const fullBanner = document.getElementById('fullDeadlineBanner');
    if (deadlineRaw) {
        const msg = isPast
            ? `⚠️ The posted submission deadline (${deadlineLabel}) has passed. Contact ${email} to check if late submissions are being accepted.`
            : `📅 Current submission deadline: <strong>${deadlineLabel}</strong>. Send completed manuscripts to <strong>${email}</strong>.`;
        if (quickBanner) { quickBanner.innerHTML = msg; quickBanner.style.display = 'block'; }
        if (fullBanner) { fullBanner.innerHTML = msg; fullBanner.style.display = 'block'; }
    }

    const quickEmailBtn = document.getElementById('quickEmailBtn');
    if (quickEmailBtn && !quickEmailBtn.dataset.bound) {
        quickEmailBtn.dataset.bound = '1';
        quickEmailBtn.addEventListener('click', () => {
            window.location.href = `mailto:${siteSettings.submission_email || 'kjsss@kasu.edu.ng'}`;
        });
    }
}

function updateWordCount(fieldId, counterId, maxWords) {
    const field = document.getElementById(fieldId);
    const counter = document.getElementById(counterId);
    if (!field || !counter) return;
    const words = field.value.trim().split(/\s+/).filter(Boolean);
    const count = field.value.trim() ? words.length : 0;
    counter.textContent = `${count}/${maxWords} words`;
    counter.style.color = count > maxWords ? '#ef4444' : '';
}

// ─── RENDER FUNCTIONS ──────────────────────────────
function formatDate(d) {
    try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return 'Invalid date'; }
}

function getBadgeColor(tag) {
    const c = { 'Urban Studies': 'badge-urban', 'Policy': 'badge-policy', 'Gender': 'badge-gender' };
    return c[tag] || 'badge-sociology';
}

function renderJournalCard(a) {
    const tags = a.tags || [];
    const fileLabel = a.pdf_url && /\.(doc|docx)(\?|$)/i.test(a.pdf_url) ? '📄 File' : '📄 PDF';
    const pdfLink = a.pdf_url ? `<a href="${a.pdf_url}" target="_blank" style="font-size:11px;color:var(--kasu-green);">${fileLabel}</a>` : '';
    // If this journal entry has a linked submitter (i.e. it was published via
    // the author-account submission flow), make the byline clickable through
    // to that author's public profile page.
    const authorsHtml = a.submitter_id
        ? `<a onclick="showAuthorPage('${a.submitter_id}')" style="cursor:pointer;text-decoration:underline;">${a.authors}</a>`
        : a.authors;
    const orcidBadge = a.orcid
        ? `<a href="https://orcid.org/${a.orcid}" target="_blank" rel="noopener" class="orcid-badge" onclick="event.stopPropagation()">iD</a>`
        : '';
    return `<div class="journal-card">
        <div class="journal-meta">
            <span class="journal-vol">Vol. ${a.volume} · ${a.year}</span>
            <span class="journal-year">${formatDate(a.published_date)}</span>
        </div>
        <h3>${a.title}</h3>
        <div class="authors">${authorsHtml}${orcidBadge}</div>
        <p class="journal-abstract">${a.abstract}</p>
        <div class="journal-card-footer">
            <div class="badge-area">
                <span class="review-badge"><span class="seal-dot">✓</span>Peer Reviewed</span>
                ${tags.slice(0,1).map(t => `<span class="badge ${getBadgeColor(t)}">${t}</span>`).join('')}
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                ${pdfLink}
                <button class="read-btn" onclick="navigateToArticle('${a.slug}')">Read →</button>
            </div>
        </div>
    </div>`;
}

function renderFacultyCard(m) {
    const safeName = m.name || 'Unnamed';
    const i = safeName.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
    return `<div class="faculty-card">
        <div class="faculty-photo">${m.photo_url ? `<img src="${m.photo_url}" alt="${safeName}">` : i}</div>
        <div class="faculty-info">
            <h4>${safeName}</h4>
            <div class="title">${m.title || ''}</div>
            <div class="specialization">${m.specialization || ''}</div>
        </div>
    </div>`;
}

function renderNewsItem(n) {
    const d = new Date(n.date);
    const mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const tc = { 'Seminar': 'type-event', 'Call for Papers': 'type-call', 'Department News': 'type-news', 'Workshop': 'type-event' } [n.type] || 'type-news';
    return `<div class="news-item">
        <div class="news-date-block"><span class="day">${d.getDate()}</span><span class="month">${mn[d.getMonth()]}</span></div>
        <div><span class="news-type ${tc}">${n.type}</span><h4>${n.title}</h4><p>${n.description}</p></div>
    </div>`;
}

function renderProgrammeCard(p) {
    const colors = { 'B.Sc': '#3b82f6', 'M.Sc': '#22c55e', 'PhD': '#a855f7' };
    return `<div style="border-left:4px solid ${colors[p.level]||'#ccc'};background:white;border-radius:10px;padding:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.5rem;">
            <h3 style="font-family:'Playfair Display',serif;font-size:1.2rem;">${p.title}</h3>
            <span style="font-size:12px;font-weight:600;background:#f5f5f5;padding:2px 10px;border-radius:100px;">${p.level}</span>
        </div>
        <p style="color:var(--text-secondary);font-size:14px;margin-bottom:0.5rem;">${p.description}</p>
        ${p.duration ? `<p style="font-size:12px;color:var(--text-muted);">⏱️ ${p.duration}</p>` : ''}
    </div>`;
}

// ─── ARTICLE PAGE (real, shareable URL) ──────────────
// Navigates to a real article page at ?article=slug, updating browser
// history so the URL is shareable and back/forward work correctly.
function navigateToArticle(slug, replace) {
    const url = new URL(window.location.href);
    url.searchParams.set('article', slug);
    if (replace) {
        window.history.replaceState({ article: slug }, '', url);
    } else {
        window.history.pushState({ article: slug }, '', url);
    }
    showPage('article');
    loadArticlePage(slug);
}

let currentArticle = null; // the journal row currently shown on the article page

async function loadArticlePage(slug) {
    const headerEl = document.getElementById('articleHeaderContainer');
    const bodyEl = document.getElementById('articleBodyContainer');
    const citeEl = document.getElementById('articleCitationContainer');
    bodyEl.style.display = 'none';
    citeEl.style.display = 'none';
    headerEl.innerHTML = '<div class="loading"><div class="loading-spinner"></div>Loading article...</div>';

    try {
        const { data: a, error } = await db.from('journals').select('*').eq('slug', slug).single();
        if (error) throw error;
        currentArticle = a;

        const authorsHtml = a.submitter_id
            ? `<a onclick="showAuthorPage('${a.submitter_id}')" style="cursor:pointer;text-decoration:underline;color:inherit;">${a.authors}</a>`
            : a.authors;
        const orcidBadge = a.orcid
            ? `<a href="https://orcid.org/${a.orcid}" target="_blank" rel="noopener" class="orcid-badge">iD ${a.orcid}</a>`
            : '';

        headerEl.innerHTML = `
            <span class="journal-vol">Vol. ${a.volume} · ${a.year}</span>
            <h1>${a.title}</h1>
            <div class="authors-line">${authorsHtml}${orcidBadge}</div>
            <div class="badges-row">
                <span class="review-badge"><span class="seal-dot">✓</span>Double-Blind Peer Reviewed</span>
                ${(a.tags || []).map(t => `<span class="badge ${getBadgeColor(t)}">${t}</span>`).join('')}
            </div>
        `;

        document.getElementById('articleAbstractText').textContent = a.abstract;
        document.getElementById('articleKeywordsList').innerHTML = (a.tags || [])
            .map(t => `<span class="badge badge-sociology">${t}</span>`).join('');
        document.getElementById('articlePdfLinkWrap').innerHTML = a.pdf_url
            ? `<a href="${a.pdf_url}" target="_blank" class="btn-primary">📄 Download Full Article</a>`
            : '<p style="font-size:13px;color:var(--text-muted);">No downloadable file available for this article.</p>';
        bodyEl.style.display = 'block';

        switchCitationFormat('apa');
        citeEl.style.display = 'block';
    } catch (e) {
        console.error('Error loading article:', e);
        headerEl.innerHTML = '<p style="text-align:center;color:#dc2626;">Article not found.</p>';
    }
}

// ─── CITATIONS ────────────────────────────────────────
function buildApaCitation(a) {
    const authors = a.authors || 'Unknown Author';
    return `${authors} (${a.year}). ${a.title}. KASU Journal of Sociology & Social Sciences, ${a.volume}.`;
}

function buildBibtexCitation(a) {
    const key = (a.slug || 'article').replace(/[^a-z0-9]/gi, '');
    const authors = (a.authors || 'Unknown Author').replace(/;/g, ' and');
    return `@article{${key}${a.year},\n  title={${a.title}},\n  author={${authors}},\n  journal={KASU Journal of Sociology \\& Social Sciences},\n  volume={${a.volume}},\n  year={${a.year}}\n}`;
}

let currentCitationFormat = 'apa';
function switchCitationFormat(format) {
    if (!currentArticle) return;
    currentCitationFormat = format;
    document.getElementById('citeTabApa').classList.toggle('active', format === 'apa');
    document.getElementById('citeTabBibtex').classList.toggle('active', format === 'bibtex');
    document.getElementById('citationBoxText').textContent = format === 'apa'
        ? buildApaCitation(currentArticle)
        : buildBibtexCitation(currentArticle);
}

function copyCitation() {
    const text = document.getElementById('citationBoxText').textContent;
    navigator.clipboard.writeText(text).then(() => {
        showToast('Citation copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Could not copy — please select and copy manually.', 'error');
    });
}

// Handles browser Back/Forward through article history
window.addEventListener('popstate', (e) => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('article');
    if (slug) {
        showPage('article');
        loadArticlePage(slug);
    } else {
        showPage('home');
    }
});

// ─── EDITORIAL BOARD ──────────────────────────────────
async function renderEditorialBoard() {
    const grid = document.getElementById('editorialBoardGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="loading"><div class="loading-spinner"></div>Loading...</div>';
    try {
        const { data, error } = await db.from('editorial_board_public').select('*');
        if (error) throw error;

        if (!data || !data.length) {
            grid.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:2rem;">Editorial board information coming soon.</p>';
            return;
        }

        grid.innerHTML = data.map(m => {
            const sealClass = m.role === 'admin' ? 'credential-seal credential-seal--admin' : 'credential-seal credential-seal--reviewer';
            const plaqueClass = m.role === 'admin' ? 'role-plaque role-plaque--admin' : 'role-plaque role-plaque--reviewer';
            const roleLabel = m.title || (m.role === 'admin' ? 'Editor-in-Chief' : 'Peer Reviewer');
            const avatar = m.avatar_url
                ? `<img src="${m.avatar_url}" alt="${m.full_name}" style="width:100%;height:100%;object-fit:cover;">`
                : initialsFromName(m.full_name);
            return `<div class="board-card">
                <div class="${sealClass}">${avatar}</div>
                <div class="board-name">${m.full_name}</div>
                <span class="${plaqueClass}">${roleLabel}</span>
                <div class="board-title">${m.affiliation || ''}</div>
                ${m.bio ? `<p class="board-bio">${m.bio}</p>` : ''}
            </div>`;
        }).join('');
    } catch (e) {
        console.error('Error loading editorial board:', e);
        grid.innerHTML = '<p style="color:#dc2626;text-align:center;">Could not load editorial board.</p>';
    }
}

// ─── SEARCH & FILTERS ──────────────────────────────────
function searchJournals() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    const container = document.getElementById('featuredJournals');
    const filtered = allJournals.filter(j =>
        j.title.toLowerCase().includes(query) ||
        j.authors.toLowerCase().includes(query) ||
        (j.tags||[]).some(t => t.toLowerCase().includes(query)) ||
        j.abstract.toLowerCase().includes(query)
    );
    container.innerHTML = filtered.map(renderJournalCard).join('') ||
        '<p style="text-align:center;color:var(--text-muted);padding:2rem;">No articles found.</p>';
}

// Populates the Volume / Year / Research Area filter dropdowns from
// whatever unique values currently exist in allJournals.
function populateJournalFilters() {
    const volEl = document.getElementById('filterVolume');
    const yearEl = document.getElementById('filterYear');
    const areaEl = document.getElementById('filterArea');
    if (!volEl || !yearEl || !areaEl) return;

    const volumes = [...new Set(allJournals.map(j => j.volume))].sort((a, b) => b - a);
    const years = [...new Set(allJournals.map(j => j.year))].sort((a, b) => b - a);
    const areas = [...new Set(allJournals.flatMap(j => j.tags || []))].sort();

    const keepSelected = (el, val) => { if (val) el.value = val; };
    const prevVol = volEl.value, prevYear = yearEl.value, prevArea = areaEl.value;

    volEl.innerHTML = '<option value="">All Volumes</option>' + volumes.map(v => `<option value="${v}">Volume ${v}</option>`).join('');
    yearEl.innerHTML = '<option value="">All Years</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
    areaEl.innerHTML = '<option value="">All Research Areas</option>' + areas.map(a => `<option value="${a}">${a}</option>`).join('');

    keepSelected(volEl, prevVol);
    keepSelected(yearEl, prevYear);
    keepSelected(areaEl, prevArea);
}

function clearJournalFilters() {
    const volEl = document.getElementById('filterVolume');
    const yearEl = document.getElementById('filterYear');
    const areaEl = document.getElementById('filterArea');
    const searchEl = document.getElementById('searchJournalsPage');
    if (volEl) volEl.value = '';
    if (yearEl) yearEl.value = '';
    if (areaEl) areaEl.value = '';
    if (searchEl) searchEl.value = '';
    searchJournalsPage();
}

function searchJournalsPage() {
    const query = (document.getElementById('searchJournalsPage').value || '').toLowerCase();
    const volFilter = document.getElementById('filterVolume') ? document.getElementById('filterVolume').value : '';
    const yearFilter = document.getElementById('filterYear') ? document.getElementById('filterYear').value : '';
    const areaFilter = document.getElementById('filterArea') ? document.getElementById('filterArea').value : '';
    const container = document.getElementById('allJournalsGrid');

    const filtered = allJournals.filter(j => {
        const matchesQuery = !query ||
            j.title.toLowerCase().includes(query) ||
            j.authors.toLowerCase().includes(query) ||
            (j.tags||[]).some(t => t.toLowerCase().includes(query)) ||
            j.abstract.toLowerCase().includes(query);
        const matchesVol = !volFilter || String(j.volume) === volFilter;
        const matchesYear = !yearFilter || String(j.year) === yearFilter;
        const matchesArea = !areaFilter || (j.tags || []).includes(areaFilter);
        return matchesQuery && matchesVol && matchesYear && matchesArea;
    });

    container.innerHTML = filtered.map(renderJournalCard).join('') ||
        '<p style="text-align:center;color:var(--text-muted);padding:2rem;">No articles found.</p>';
}

// ─── RENDER PAGES ──────────────────────────────────
function renderHomePage() {
    renderSectionOrError('featuredJournals', allJournals.slice(0, 6), renderJournalCard, fetchErrors.journals, 'No articles found.', 'journals');
    renderSectionOrError('homeNewsList', allNews.slice(0, 4), renderNewsItem, fetchErrors.news, 'No news found.', 'news');
    renderSectionOrError('homeFacultyGrid', allFaculty.slice(0, 8), renderFacultyCard, fetchErrors.faculty, 'No faculty found.', 'faculty');

    try {
        const archiveContainer = document.getElementById('archiveList');
        if (fetchErrors.journals) {
            archiveContainer.innerHTML = '<li>Couldn\'t load — <a onclick="retrySection(\'journals\')">retry</a></li>';
        } else {
            const volumes = [...new Set(allJournals.map(j => `Volume ${j.volume} (${j.year})`))];
            archiveContainer.innerHTML = volumes.map(v => `<li>${v}</li>`).join('') || '<li>No volumes</li>';
        }
    } catch (e) {
        console.error('Error rendering archive list:', e);
        const archiveContainer = document.getElementById('archiveList');
        if (archiveContainer) archiveContainer.innerHTML = '<li>Couldn\'t load</li>';
    }

    try {
        const validYears = allJournals.map(j => j.year).filter(y => typeof y === 'number' && !isNaN(y));
        const yearsOfPublication = validYears.length ? new Date().getFullYear() - Math.min(...validYears) + 1 : 0;
        const uniqueTags = new Set(allJournals.flatMap(j => j.tags || []));
        document.getElementById('statYears').textContent = `${yearsOfPublication}+`;
        document.getElementById('statAreas').textContent = uniqueTags.size || 6;
        document.getElementById('statArticles').textContent = `${allJournals.length}+`;
        document.getElementById('statFaculty').textContent = allFaculty.length || 48;
    } catch (e) {
        console.error('Error rendering stats:', e);
    }
}

function renderAllPages() {
    renderSectionOrError('allJournalsGrid', allJournals, renderJournalCard, fetchErrors.journals, 'No articles found.', 'journals');
    renderSectionOrError('allFacultyGrid', allFaculty, renderFacultyCard, fetchErrors.faculty, 'No faculty found.', 'faculty');
    renderSectionOrError('allNewsList', allNews, renderNewsItem, fetchErrors.news, 'No news found.', 'news');
    renderSectionOrError('programmesGrid', allProgrammes, renderProgrammeCard, fetchErrors.programmes, 'No programmes found.', 'programmes');
    populateJournalFilters();
}

// ─── SUBMIT PAPER (now requires a logged-in author) ──
async function submitPaper(e) {
    e.preventDefault();
    const btn = document.getElementById('fullSubmitBtn');
    const originalText = btn ? btn.textContent : '';

    if (!currentUser) {
        showToast('Please log in or create an account to submit a manuscript.', 'error');
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    try {
        if (!db) {
            await initSupabaseWithRetry(8, 250);
        }

        const abstractField = document.getElementById('subAbstractFull');
        const abstractWords = abstractField.value.trim().split(/\s+/).filter(Boolean).length;
        if (abstractWords > 250) {
            showToast(`Abstract is ${abstractWords} words — please shorten it to 250 words or fewer.`, 'error');
            if (btn) { btn.disabled = false; btn.textContent = originalText; }
            return;
        }

        const payload = {
            submitter_id: currentUser.id,
            author_name: document.getElementById('subAuthorFull').value,
            email: currentUser.email,
            title: document.getElementById('subTitleFull').value,
            research_area: document.getElementById('subAreaFull').value,
            abstract: document.getElementById('subAbstractFull').value,
            keywords: document.getElementById('subKeywordsFull').value,
            ai_tools_disclosure: document.getElementById('subAiToolsFull').value || 'None',
            manuscript_path: document.getElementById('subManuscriptPathFull').value || null,
            manuscript_filename: document.getElementById('subManuscriptNameFull').value || null,
        };

        // Deliberately not chaining .select() here — read-back after insert
        // is subject to RLS too, and it isn't needed since we already have
        // the payload in hand for the notification email below.
        const { error } = await db.from('submissions').insert(payload);
        if (error) throw error;

        try {
            await withTimeout(db.functions.invoke('notify-submission', { body: { record: payload } }), 10000);
        } catch (notifyErr) {
            console.warn('Submission saved, but admin notification email failed:', notifyErr.message);
        }

        showToast('Thank you! Your submission has been received.', 'success');
        e.target.reset();
        document.getElementById('subManuscriptPathFull').value = '';
        document.getElementById('subManuscriptNameFull').value = '';
        document.querySelectorAll('[id$="_status"]').forEach(el => el.textContent = '');
        document.querySelectorAll('[id$="_preview"]').forEach(el => el.innerHTML = '');
        const countEl = document.getElementById('fullAbstractCount');
        if (countEl) countEl.textContent = '0/250 words';

        loadMySubmissions();
    } catch (err) {
        console.error('Submission error:', err);
        showToast(err.message || 'Error submitting paper. Please try again or email us directly.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
}
