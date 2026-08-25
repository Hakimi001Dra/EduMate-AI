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

        db.auth.onAuthStateChange((_event, session) => {
            currentUser = session ? session.user : null;
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
        loginBtn.style.color = 'var(--kasu-green)';
        loginBtn.style.borderBottom = '2px solid var(--kasu-green)';
        registerBtn.style.color = 'var(--text-muted)';
        registerBtn.style.borderBottom = 'none';
    } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        registerBtn.style.color = 'var(--kasu-green)';
        registerBtn.style.borderBottom = '2px solid var(--kasu-green)';
        loginBtn.style.color = 'var(--text-muted)';
        loginBtn.style.borderBottom = 'none';
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
        showToast('Logged out', 'info');
        renderSubmitPageAuthState();
    } catch (e) {
        showToast('Error logging out', 'error');
    }
}

// Shows the login/register tabs if logged out, or the submission form +
// "My Submissions" list if logged in. Called on init, on auth changes,
// and whenever the Submit page is opened.
function renderSubmitPageAuthState() {
    const gate = document.getElementById('authGateContainer');
    const authed = document.getElementById('authedSubmitContainer');
    if (!gate || !authed) return; // not on the submit page yet

    if (currentUser) {
        gate.style.display = 'none';
        authed.style.display = 'block';
        const emailEl = document.getElementById('authedUserEmail');
        if (emailEl) emailEl.textContent = currentUser.email;
        loadMySubmissions();
    } else {
        gate.style.display = 'block';
        authed.style.display = 'none';
    }
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

        const statusColors = {
            pending: '#767676',
            in_review: '#c8941a',
            accepted: '#16a34a',
            rejected: '#dc2626'
        };
        const statusLabels = {
            pending: 'Pending Review',
            in_review: 'In Review',
            accepted: 'Accepted',
            rejected: 'Rejected'
        };

        container.innerHTML = data.map(s => `
            <div style="border:1px solid var(--border);border-radius:8px;padding:1rem 1.25rem;margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
                <div>
                    <div style="font-weight:600;font-size:14.5px;">${s.title}</div>
                    <div style="font-size:12.5px;color:var(--text-muted);">Submitted ${formatDate(s.created_at)}${s.research_area ? ' · ' + s.research_area : ''}</div>
                </div>
                <span style="font-size:12px;font-weight:600;padding:4px 12px;border-radius:100px;color:#fff;background:${statusColors[s.status] || '#767676'};">${statusLabels[s.status] || s.status}</span>
            </div>
        `).join('');
    } catch (e) {
        console.error('Error loading my submissions:', e);
        container.innerHTML = '<p style="color:#dc2626;font-size:14px;">Could not load your submissions. Please refresh.</p>';
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
    return `<div class="journal-card">
        <div class="journal-meta">
            <span class="journal-vol">Vol. ${a.volume} · ${a.year}</span>
            <span class="journal-year">${formatDate(a.published_date)}</span>
        </div>
        <h3>${a.title}</h3>
        <div class="authors">${a.authors}</div>
        <p class="journal-abstract">${a.abstract}</p>
        <div class="journal-card-footer">
            <div class="badge-area">${tags.slice(0,2).map(t => `<span class="badge ${getBadgeColor(t)}">${t}</span>`).join('')}</div>
            <div style="display:flex;gap:8px;align-items:center;">
                ${pdfLink}
                <button class="read-btn" onclick="viewArticle('${a.slug}')">Read →</button>
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

// ─── VIEW ARTICLE ──────────────────────────────────
async function viewArticle(slug) {
    try {
        const { data: a, error } = await db.from('journals').select('*').eq('slug', slug).single();
        if (error) throw error;
        const modal = document.createElement('div');
        modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:2rem;overflow-y:auto;`;
        modal.innerHTML = `<div style="background:white;border-radius:12px;max-width:800px;width:100%;max-height:90vh;overflow-y:auto;padding:2rem;position:relative;">
            <button onclick="this.closest('div[style]').remove()" style="position:sticky;top:0;float:right;background:none;border:none;font-size:28px;cursor:pointer;">✕</button>
            <h1 style="font-family:'Playfair Display',serif;font-size:1.8rem;">${a.title}</h1>
            <p style="color:var(--text-muted);font-style:italic;">${a.authors}</p>
            <p style="font-size:14px;color:var(--text-muted);margin:1rem 0;">Vol. ${a.volume} · ${a.year}</p>
            <h2>Abstract</h2>
            <p style="color:var(--text-secondary);line-height:1.8;">${a.abstract}</p>
            ${a.pdf_url ? `<a href="${a.pdf_url}" target="_blank" class="btn-primary" style="display:inline-block;margin-top:1rem;">📄 Download File</a>` : ''}
        </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    } catch (e) { showToast('Error loading article', 'error'); }
}

// ─── SEARCH ──────────────────────────────────────────
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

function searchJournalsPage() {
    const query = document.getElementById('searchJournalsPage').value.toLowerCase();
    const container = document.getElementById('allJournalsGrid');
    const filtered = allJournals.filter(j =>
        j.title.toLowerCase().includes(query) ||
        j.authors.toLowerCase().includes(query) ||
        (j.tags||[]).some(t => t.toLowerCase().includes(query)) ||
        j.abstract.toLowerCase().includes(query)
    );
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
