// ─── ADMIN PAGE STATE ────────────────────────────────
let adminSession = null;
let siteSettings = { submission_deadline: null, submission_email: 'kjsss@kasu.edu.ng', site_logo_url: null };

function showAdminLoginView() {
    document.getElementById('adminLoginView').style.display = 'block';
    document.getElementById('adminDashboardView').style.display = 'none';
}

function showAdminDashboardView() {
    document.getElementById('adminLoginView').style.display = 'none';
    document.getElementById('adminDashboardView').style.display = 'block';
}

// ─── INIT ────────────────────────────────────────────

// Verifies the currently logged-in session actually has the 'admin' role.
// This is the real access gate — merely having a valid login is not enough,
// since authors and reviewers use the exact same Supabase Auth system.
async function verifyAdminAccess(session) {
    try {
        const { data, error } = await db.from('profiles').select('role').eq('id', session.user.id).single();
        if (error) throw error;
        return data.role === 'admin';
    } catch (e) {
        console.error('Could not verify admin role:', e);
        return false;
    }
}

let isAdminPasswordRecoveryFlow = false;

// Checks the URL directly for the recovery link's marker, rather than
// relying only on Supabase's onAuthStateChange event — that event alone
// proved unreliable on the author/reviewer side, so the same defensive
// check is applied here too.
function checkForAdminPasswordRecoveryInUrl() {
    const hash = window.location.hash || '';
    if (hash.includes('type=recovery')) return true;
    const params = new URLSearchParams(window.location.search);
    return params.get('type') === 'recovery';
}

function showAdminPasswordRecoveryForm() {
    showAdminLoginView();
    document.getElementById('adminLoginForm').style.display = 'none';
    document.getElementById('adminForgotForm').style.display = 'none';
    document.getElementById('adminResetPasswordForm').style.display = 'block';
}

async function init() {
    try {
        // Check BEFORE creating the Supabase client — client creation is
        // what triggers Supabase to read and then strip this from the URL.
        isAdminPasswordRecoveryFlow = checkForAdminPasswordRecoveryInUrl();

        await initSupabaseWithRetry();
        initFileUploads();

        db.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') {
                isAdminPasswordRecoveryFlow = true;
            }
            if (isAdminPasswordRecoveryFlow) {
                showAdminPasswordRecoveryForm();
            }
        });

        if (isAdminPasswordRecoveryFlow) {
            showAdminPasswordRecoveryForm();
            return;
        }

        const { data } = await db.auth.getSession();
        if (data.session) {
            const isAdmin = await verifyAdminAccess(data.session);
            if (!isAdmin) {
                // Not an admin account — don't grant dashboard access, even
                // though the login itself was valid. Sign them out so a
                // stray session can't silently sit here.
                await db.auth.signOut();
                showAdminLoginView();
                const err = document.getElementById('adminLoginError');
                if (err) {
                    err.textContent = 'This account does not have admin access.';
                    err.style.display = 'block';
                }
                return;
            }
            adminSession = data.session;
            showAdminDashboardView();
            loadAdminDashboard();
            loadAdminIdentity();
        } else {
            showAdminLoginView();
        }
    } catch (e) {
        console.error('Admin init error:', e);
        showPersistentError('⚠️ ' + (e.message || 'Could not connect to the server. Please refresh the page.'));
        showAdminLoginView();
    }
}

document.addEventListener('DOMContentLoaded', init);

// ─── ADMIN FUNCTIONS ─────────────────────────────────

function showAdminPage(page) {
    document.querySelectorAll('.admin-content > div').forEach(el => el.style.display = 'none');
    const target = document.getElementById(`admin-${page}`);
    if (target) target.style.display = 'block';
    document.querySelectorAll('.admin-sidebar nav a').forEach(a => a.classList.remove('active'));
    const link = document.querySelector(`.admin-sidebar nav a[data-admin="${page}"]`);
    if (link) link.classList.add('active');
    if (page === 'dashboard') loadAdminDashboard();
    if (page === 'submissions') loadAdminSubmissions();
    if (page === 'journals') loadAdminJournals();
    if (page === 'faculty') loadAdminFaculty();
    if (page === 'news') loadAdminNews();
    if (page === 'programmes') loadAdminProgrammes();
    if (page === 'users') loadAdminUsers();
    if (page === 'settings') loadAdminSettings();
}

async function loadAdminSettings() {
    try {
        const { data, error } = await db.from('settings').select('*').in('key', ['submission_deadline', 'submission_email', 'site_logo_url']);
        if (error) throw error;
        (data || []).forEach(row => {
            if (row.key === 'submission_deadline') siteSettings.submission_deadline = row.value;
            if (row.key === 'submission_email') siteSettings.submission_email = row.value;
            if (row.key === 'site_logo_url') siteSettings.site_logo_url = row.value;
        });
    } catch (e) { console.warn('Could not load settings:', e.message); }
    const deadlineField = document.getElementById('setSubmissionDeadline');
    const emailField = document.getElementById('setSubmissionEmail');
    const logoUrlField = document.getElementById('setSiteLogoUrl');
    if (deadlineField) deadlineField.value = siteSettings.submission_deadline || '';
    if (emailField) emailField.value = siteSettings.submission_email || '';
    if (logoUrlField) logoUrlField.value = siteSettings.site_logo_url || '';

    // Admin's own name/title, stored on their profiles row (not in settings)
    if (adminSession) {
        try {
            const { data: profile } = await db.from('profiles').select('full_name, title, avatar_url').eq('id', adminSession.user.id).single();
            const nameField = document.getElementById('setAdminName');
            const titleField = document.getElementById('setAdminTitle');
            const avatarUrlField = document.getElementById('setAdminAvatarUrl');
            if (nameField) nameField.value = (profile && profile.full_name) || '';
            if (titleField) titleField.value = (profile && profile.title) || '';
            if (avatarUrlField) avatarUrlField.value = (profile && profile.avatar_url) || '';
        } catch (e) { console.warn('Could not load admin profile:', e.message); }
    }

    const logoPreview = document.getElementById('logoUpload_preview');
    if (logoPreview && siteSettings.site_logo_url) {
        logoPreview.innerHTML = `<img src="${siteSettings.site_logo_url}" alt="Current logo" style="max-width:80px;max-height:80px;border-radius:8px;"><br><span style="font-size:11px;color:var(--text-muted);">Current logo</span>`;
    }
}

function showAdminForm(type) {
    const formId = `admin${type.charAt(0).toUpperCase() + type.slice(1)}Form`;
    const el = document.getElementById(formId);
    if (el) { el.style.display = 'block'; el.scrollIntoView({ behavior: 'smooth' }); }
}

function hideAdminForm(type) {
    const formId = `admin${type.charAt(0).toUpperCase() + type.slice(1)}Form`;
    const el = document.getElementById(formId);
    if (el) el.style.display = 'none';
}

async function adminLogin(e) {
    e.preventDefault();
    const email = document.getElementById('adminEmail').value;
    const password = document.getElementById('adminPassword').value;
    const err = document.getElementById('adminLoginError');
    try {
        if (!db) await initSupabaseWithRetry(8, 250);
        const { data, error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const isAdmin = await verifyAdminAccess(data.session);
        if (!isAdmin) {
            // Valid login, but this account isn't an admin — refuse entry
            // and drop the session rather than leaving them signed in with
            // nowhere to go.
            await db.auth.signOut();
            err.textContent = 'This account does not have admin access.';
            err.style.display = 'block';
            return;
        }

        adminSession = data.session;
        err.style.display = 'none';
        showToast('Login successful!', 'success');
        showAdminDashboardView();
        loadAdminDashboard();
        loadAdminIdentity();
    } catch (e) { err.textContent = e.message || 'Invalid credentials'; err.style.display = 'block'; }
}

// ─── PASSWORD RESET (admin) ───────────────────────────
function showAdminForgotForm() {
    document.getElementById('adminLoginForm').style.display = 'none';
    document.getElementById('adminForgotForm').style.display = 'block';
}

function hideAdminForgotForm() {
    document.getElementById('adminForgotForm').style.display = 'none';
    document.getElementById('adminLoginForm').style.display = 'block';
}

async function sendAdminPasswordReset(e) {
    e.preventDefault();
    const errEl = document.getElementById('adminForgotError');
    const successEl = document.getElementById('adminForgotSuccess');
    errEl.style.display = 'none';
    successEl.style.display = 'none';
    try {
        if (!db) await initSupabaseWithRetry(8, 250);
        const email = document.getElementById('adminForgotEmail').value;
        const redirectTo = window.location.origin + window.location.pathname;
        const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        successEl.textContent = 'If an account exists for that email, a reset link has been sent. Check your inbox (and spam folder).';
        successEl.style.display = 'block';
        document.getElementById('adminForgotForm').reset();
    } catch (err) {
        errEl.textContent = err.message || 'Could not send reset link.';
        errEl.style.display = 'block';
    }
}

async function submitAdminNewPassword(e) {
    e.preventDefault();
    const errEl = document.getElementById('adminResetError');
    errEl.style.display = 'none';
    try {
        const newPassword = document.getElementById('adminNewPasswordInput').value;
        const { error } = await db.auth.updateUser({ password: newPassword });
        if (error) throw error;

        // Clear the recovery flag and strip the recovery marker out of the
        // URL first — otherwise the init() call below would immediately
        // see type=recovery again and loop straight back into this form.
        isAdminPasswordRecoveryFlow = false;
        window.history.replaceState({}, '', window.location.pathname + window.location.search);

        showToast('Password updated!', 'success');
        document.getElementById('adminResetPasswordForm').style.display = 'none';
        // Re-run init so the role check + dashboard load happen cleanly
        // now that the account is properly authenticated again.
        init();
    } catch (err) {
        errEl.textContent = err.message || 'Could not update password.';
        errEl.style.display = 'block';
    }
}

async function adminLogout() {
    await db.auth.signOut();
    adminSession = null;
    showToast('Logged out', 'info');
    showAdminLoginView();
}

// ─── LOAD ADMIN DATA ─────────────────────────────────

async function loadAdminDashboard() {
    try {
        const [{ count: jc }, { count: fc }, { count: nc }, { count: pc }, { count: sc }] = await Promise.all([
            db.from('journals').select('*', { count: 'exact', head: true }),
            db.from('faculty').select('*', { count: 'exact', head: true }),
            db.from('news_events').select('*', { count: 'exact', head: true }),
            db.from('programmes').select('*', { count: 'exact', head: true }),
            db.from('submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending')
        ]);
        document.getElementById('adminStatJournals').textContent = jc || 0;
        document.getElementById('adminStatFaculty').textContent = fc || 0;
        document.getElementById('adminStatNews').textContent = nc || 0;
        document.getElementById('adminStatProgrammes').textContent = pc || 0;
        document.getElementById('adminStatSubmissions').textContent = sc || 0;
    } catch (e) { console.error(e); }
    loadAdminActivityLog();
}

// Shows the admin's own name/title in the sidebar identity card.
async function loadAdminIdentity() {
    if (!adminSession) return;
    try {
        const { data, error } = await db.from('profiles').select('*').eq('id', adminSession.user.id).single();
        if (error) throw error;
        const nameEl = document.getElementById('adminNameDisplay');
        const avatarEl = document.getElementById('adminAvatarDisplay');
        if (nameEl) nameEl.textContent = data.full_name || adminSession.user.email;
        if (avatarEl) {
            const initials = (data.full_name || adminSession.user.email).split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();
            avatarEl.innerHTML = data.avatar_url
                ? `<img src="${data.avatar_url}" alt="" style="width:100%;height:100%;object-fit:cover;">`
                : initials;
        }
    } catch (e) {
        console.error('Could not load admin identity:', e);
    }
}

// Recent Activity widget — reads from the activity_log table, which is
// populated automatically by database triggers (status changes, reviewer
// assignments, publishes), not by the frontend directly.
async function loadAdminActivityLog() {
    const c = document.getElementById('adminActivityLog');
    if (!c) return;
    try {
        const { data, error } = await db.from('activity_log').select('*').order('created_at', { ascending: false }).limit(8);
        if (error) throw error;
        if (!data || !data.length) {
            c.innerHTML = '<p style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:13.5px;">No activity yet.</p>';
            return;
        }
        const actionIcons = { status_change: '🔄', assign_reviewer: '🧑‍🔬', publish: '📰' };
        c.innerHTML = `<div class="activity-log-list">${data.map(a => `
            <div class="activity-log-item">
                <span class="icon">${actionIcons[a.action] || '•'}</span>
                <span class="desc">${a.detail || a.action}</span>
                <span class="when">${new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            </div>
        `).join('')}</div>`;
    } catch (e) {
        c.innerHTML = '<p style="color:red;font-size:13px;">Could not load activity.</p>';
    }
}

async function loadAdminSubmissions() {
    try {
        const { data, error } = await db.from('submissions').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        const c = document.getElementById('adminSubmissionsList');
        if (!data || !data.length) { c.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted);">No submissions yet.</p>'; return; }
        c.innerHTML = `<table><thead><tr><th>Title</th><th>Author</th><th>Email</th><th>Area</th><th>File</th><th>Status</th><th>Actions</th></tr></thead><tbody>${data.map(s => {
            const publishedNote = s.published_at
                ? `<div style="font-size:11px;color:#16a34a;margin-top:4px;">✅ Published ${new Date(s.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>`
                : '';
            const notifiedNote = s.last_notified_at
                ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">🔔 Notified ${new Date(s.last_notified_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>`
                : '';
            const publishBtnLabel = s.published_at ? '📰 Publish Again' : '📰 Publish';
            const publishBtnClass = s.published_at ? 'delete-btn' : 'edit-btn';

            return `
            <tr>
                <td>${s.title}</td>
                <td>${s.author_name}</td>
                <td>${s.email}</td>
                <td>${s.research_area || '—'}</td>
                <td>${s.manuscript_path ? `<button class="edit-btn" style="padding:4px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;" onclick="downloadManuscript('${s.manuscript_path}')">📄 Download</button>` : '—'}</td>
                <td>${s.status}${publishedNote}</td>
                <td><div class="actions">
                    <button class="edit-btn" onclick="updateSubmissionStatus('${s.id}','in_review')">In Review</button>
                    <button class="edit-btn" onclick="updateSubmissionStatus('${s.id}','accepted')">Accept</button>
                    <button class="delete-btn" onclick="updateSubmissionStatus('${s.id}','rejected')">Reject</button>
                    <button class="${publishBtnClass}" onclick="publishSubmissionToJournal('${s.id}')">${publishBtnLabel}</button>
                    <button class="edit-btn" onclick="assignReviewer('${s.id}')">🧑‍🔬 Assign Reviewer</button>
                    <button class="edit-btn" onclick="viewReviewsForSubmission('${s.id}')">📝 View Reviews</button>
                    <button class="delete-btn" onclick="deleteSubmission('${s.id}', ${s.manuscript_path ? `'${s.manuscript_path}'` : 'null'})">🗑️ Delete</button>
                </div></td>
            </tr>`;
        }).join('')}</tbody></table>`;
    } catch (e) { document.getElementById('adminSubmissionsList').innerHTML = '<p style="color:red;">Error loading submissions</p>'; }
}

async function downloadManuscript(path) {
    try {
        const { data, error } = await db.storage.from('manuscripts').createSignedUrl(path, 60);
        if (error) throw error;
        window.open(data.signedUrl, '_blank');
    } catch (e) { showToast('Error generating download link', 'error'); }
}

// Updates a submission's status. (Email notification to the author has
// been removed for now — status changes are visible to the author in
// their own "My Submissions" dashboard when they log in.)
async function updateSubmissionStatus(id, status) {
    try {
        const { error } = await db.from('submissions').update({ status }).eq('id', id);
        if (error) throw error;
        showToast(`Marked as ${status}`, 'success');
        loadAdminSubmissions();
        loadAdminDashboard();
    } catch (e) { showToast('Error updating status', 'error'); }
}

// Copies an accepted submission's manuscript file from the private
// "manuscripts" bucket into the public "journal-pdfs" bucket, and creates
// a matching row in the "journals" table so it appears on the main site.
// Prompts for volume/year since submissions don't collect those.
// Stamps a green branding band across the top of a PDF's first page —
// journal name, volume, issue, and year — plus the site logo if one is
// set. Uses pdf-lib (loaded via CDN in admin.html), entirely client-side,
// no server or paid conversion service required. Only ever called on
// files already confirmed to be real PDFs.
async function stampJournalCoverPage(fileBlob, meta) {
    if (!window.PDFLib) throw new Error('PDF library not loaded — check your internet connection and refresh.');
    const { PDFDocument, rgb, StandardFonts } = window.PDFLib;

    const arrayBuffer = await fileBlob.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pages = pdfDoc.getPages();
    if (!pages.length) throw new Error('PDF has no pages');
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();
    const bandHeight = 42;

    firstPage.drawRectangle({
        x: 0,
        y: height - bandHeight,
        width,
        height: bandHeight,
        color: rgb(26 / 255, 71 / 255, 49 / 255) // matches --kasu-green
    });

    // Try to embed the site logo on the left of the band, if one is set.
    try {
        const { data: logoSetting } = await db.from('settings').select('value').eq('key', 'site_logo_url').single();
        const logoUrl = logoSetting && logoSetting.value;
        if (logoUrl) {
            const logoResp = await fetch(logoUrl);
            const logoBytes = await logoResp.arrayBuffer();
            let logoImage;
            try { logoImage = await pdfDoc.embedPng(logoBytes); }
            catch { logoImage = await pdfDoc.embedJpg(logoBytes); }
            const logoSize = bandHeight - 12;
            const scale = logoSize / logoImage.height;
            firstPage.drawImage(logoImage, {
                x: 12,
                y: height - bandHeight + 6,
                width: logoImage.width * scale,
                height: logoSize
            });
        }
    } catch (logoErr) {
        console.warn('Could not embed logo into cover stamp (continuing without it):', logoErr);
    }

    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const label = `KJSSS · Vol. ${meta.volume}${meta.issue ? ', Issue ' + meta.issue : ''} (${meta.year})`;
    const fontSize = 11;
    const textWidth = font.widthOfTextAtSize(label, fontSize);

    firstPage.drawText(label, {
        x: width - textWidth - 16,
        y: height - bandHeight / 2 - fontSize / 2 + 2,
        size: fontSize,
        font,
        color: rgb(1, 1, 1)
    });

    const stampedBytes = await pdfDoc.save();
    return new Blob([stampedBytes], { type: 'application/pdf' });
}

async function publishSubmissionToJournal(id) {
    try {
        const { data: sub, error } = await db.from('submissions').select('*').eq('id', id).single();
        if (error) throw error;

        // Already published before — this is the exact double-publish
        // scenario we want to catch, so make it unmistakable.
        if (sub.published_at) {
            const when = new Date(sub.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            if (!confirm(`⚠️ This submission was already published on ${when}. Publishing again will create a SECOND, duplicate entry in Journals. Continue anyway?`)) return;
        }

        if (sub.status !== 'accepted') {
            if (!confirm(`This submission is currently "${sub.status}", not "accepted". Publish anyway?`)) return;
        }

        const volume = prompt('Volume number for this issue:', '');
        if (volume === null) return; // cancelled
        const issue = prompt('Issue number (optional — leave blank if none):', '');
        if (issue === null) return; // cancelled
        const year = prompt('Publication year:', String(new Date().getFullYear()));
        if (year === null) return; // cancelled

        let pdfUrl = null;
        if (sub.manuscript_path) {
            const { data: fileBlob, error: dlErr } = await db.storage.from('manuscripts').download(sub.manuscript_path);
            if (dlErr) throw new Error('Could not download manuscript: ' + dlErr.message);

            const isPdf = /\.pdf$/i.test(sub.manuscript_filename || '') || fileBlob.type === 'application/pdf';
            let fileToUpload = fileBlob;

            if (isPdf) {
                try {
                    fileToUpload = await stampJournalCoverPage(fileBlob, {
                        volume: parseInt(volume) || 1,
                        issue: issue ? parseInt(issue) : null,
                        year: parseInt(year) || new Date().getFullYear()
                    });
                } catch (stampErr) {
                    console.error('Cover-page stamping failed, publishing original file instead:', stampErr);
                    showToast('Could not brand the cover page — publishing the original file instead.', 'error');
                }
            } else {
                showToast('File is not a PDF — publishing without the automatic cover branding.', 'info');
            }

            const destPath = `published_${Date.now()}_${sub.manuscript_filename || 'manuscript.pdf'}`;
            const { error: upErr } = await db.storage.from('journal-pdfs').upload(destPath, fileToUpload, { upsert: false });
            if (upErr) throw new Error('Could not copy manuscript to public journals bucket: ' + upErr.message);

            const { data: { publicUrl } } = db.storage.from('journal-pdfs').getPublicUrl(destPath);
            pdfUrl = publicUrl;
        }

        const title = sub.title;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
        const tags = sub.research_area ? [sub.research_area] : [];

        // Pull the author's ORCID from their profile, if they've set one —
        // shown on the public article page and journal card.
        let authorOrcid = null;
        if (sub.submitter_id) {
            const { data: authorProfile } = await db.from('profiles').select('orcid').eq('id', sub.submitter_id).single();
            authorOrcid = (authorProfile && authorProfile.orcid) || null;
        }

        const { error: insErr } = await db.from('journals').insert({
            title,
            slug,
            authors: sub.author_name,
            abstract: sub.abstract,
            volume: parseInt(volume) || 1,
            issue: issue ? parseInt(issue) : null,
            year: parseInt(year) || new Date().getFullYear(),
            published_date: new Date().toISOString().slice(0, 10),
            tags,
            pdf_url: pdfUrl,
            submitter_id: sub.submitter_id || null,
            orcid: authorOrcid
        });
        if (insErr) throw insErr;

        // Record that this submission has now been published, so the
        // table can warn before it happens again.
        const { error: stampErr } = await db.from('submissions').update({ published_at: new Date().toISOString() }).eq('id', id);
        if (stampErr) {
            console.error('Journal entry created, but failed to record published_at:', stampErr);
            showToast('Published, but could not record the timestamp: ' + stampErr.message, 'error');
        }

        showToast('Published to Journals!', 'success');
        loadAdminJournals();
        loadAdminSubmissions();
    } catch (e) {
        console.error(e);
        showToast(e.message || 'Error publishing submission', 'error');
    }
}

// Permanently deletes a submission row (and its manuscript file, if any).
async function deleteSubmission(id, manuscriptPath) {
    if (!confirm('Delete this submission permanently? This cannot be undone.')) return;
    try {
        if (manuscriptPath) {
            await db.storage.from('manuscripts').remove([manuscriptPath]);
        }
        const { error } = await db.from('submissions').delete().eq('id', id);
        if (error) throw error;
        showToast('Submission deleted', 'success');
        loadAdminSubmissions();
        loadAdminDashboard();
    } catch (e) {
        showToast(e.message || 'Error deleting submission', 'error');
    }
}

// ─── USERS & REVIEWERS ────────────────────────────────

async function loadAdminUsers() {
    try {
        const { data, error } = await db.from('profiles').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        const c = document.getElementById('adminUsersList');
        if (!data || !data.length) { c.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted);">No users yet.</p>'; return; }
        c.innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody>${data.map(u => `
            <tr>
                <td>${u.full_name || '—'}</td>
                <td>${u.email}</td>
                <td><span style="font-size:12px;font-weight:600;padding:3px 10px;border-radius:100px;background:${u.role === 'admin' ? '#dc2626' : u.role === 'reviewer' ? '#c8941a' : '#767676'};color:#fff;">${u.role}</span></td>
                <td><div class="actions">
                    ${u.role !== 'reviewer' ? `<button class="edit-btn" onclick="updateUserRole('${u.id}','reviewer')">Make Reviewer</button>` : `<button class="edit-btn" onclick="updateUserRole('${u.id}','user')">Remove Reviewer Role</button>`}
                </div></td>
            </tr>`).join('')}</tbody></table>`;
    } catch (e) { document.getElementById('adminUsersList').innerHTML = '<p style="color:red;">Error loading users</p>'; }
}

async function updateUserRole(userId, newRole) {
    // Guard against accidentally demoting the account you're currently
    // logged in with — this exact mistake previously locked the admin
    // dashboard out from itself.
    if (adminSession && userId === adminSession.user.id && newRole !== 'admin') {
        const confirmed = confirm('This is your own currently logged-in account. Changing its role away from Admin may lock you out of this dashboard immediately. Continue anyway?');
        if (!confirmed) return;
    }
    try {
        const { error } = await db.from('profiles').update({ role: newRole }).eq('id', userId);
        if (error) throw error;
        showToast(`Role updated to ${newRole}`, 'success');
        loadAdminUsers();
    } catch (e) {
        showToast(e.message || 'Error updating role', 'error');
    }
}

// Assigns a reviewer (by email) to a submission. The reviewer must already
// have the 'reviewer' role — promote them first under Users & Reviewers.
async function assignReviewer(submissionId) {
    try {
        const email = prompt('Enter the reviewer\'s email address (they must already have the Reviewer role):');
        if (!email) return;

        const { data: profile, error: profErr } = await db.from('profiles').select('*').eq('email', email.trim()).single();
        if (profErr || !profile) {
            showToast('No account found with that email.', 'error');
            return;
        }
        if (profile.role !== 'reviewer') {
            showToast(`${email} is not a Reviewer yet. Promote them first under Users & Reviewers.`, 'error');
            return;
        }

        const { error } = await db.from('submission_reviewers').insert({
            submission_id: submissionId,
            reviewer_id: profile.id
        });
        if (error) {
            if (error.code === '23505') {
                showToast('That reviewer is already assigned to this submission.', 'error');
            } else {
                throw error;
            }
            return;
        }
        showToast(`Assigned ${email} as reviewer.`, 'success');
    } catch (e) {
        showToast(e.message || 'Error assigning reviewer', 'error');
    }
}

// Shows all reviews submitted for a submission, so the admin can weigh
// them before making a final Accept/Reject decision.
async function viewReviewsForSubmission(submissionId) {
    try {
        const { data, error } = await db.from('reviews').select('*').eq('submission_id', submissionId).order('created_at', { ascending: false });
        if (error) throw error;

        if (!data || !data.length) {
            alert('No reviews submitted yet for this manuscript.');
            return;
        }

        // A modal, not alert() — alert() can't render a clickable download
        // link for a reviewer's optional attachment.
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;padding:2rem;overflow-y:auto;';
        modal.innerHTML = `<div style="background:white;border-radius:12px;max-width:640px;width:100%;max-height:85vh;overflow-y:auto;padding:2rem;position:relative;">
            <button onclick="this.closest('div[style*=fixed]').remove()" style="position:sticky;top:0;float:right;background:none;border:none;font-size:24px;cursor:pointer;">✕</button>
            <h2 style="font-family:'Playfair Display',serif;font-size:1.4rem;margin-bottom:1.25rem;color:var(--kasu-green);">Submitted Reviews (${data.length})</h2>
            ${data.map((r, i) => `
                <div style="border:1px solid var(--border);border-radius:8px;padding:1rem 1.25rem;margin-bottom:1rem;">
                    <div style="font-weight:600;font-size:13.5px;margin-bottom:6px;">Review ${i + 1} — <span style="text-transform:capitalize;">${r.recommendation.replace('_', ' ')}</span></div>
                    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;"><strong>To Editor:</strong> ${r.comments_to_editor || '—'}</div>
                    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:${r.attachment_path ? '10px' : '0'};"><strong>To Author:</strong> ${r.comments_to_author || '—'}</div>
                    ${r.attachment_path ? `<button type="button" class="edit-btn" style="padding:4px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;" onclick="downloadReviewAttachment('${r.attachment_path}')">📎 ${r.attachment_filename || 'Download Attachment'}</button>` : ''}
                </div>
            `).join('')}
        </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    } catch (e) {
        showToast(e.message || 'Error loading reviews', 'error');
    }
}

async function downloadReviewAttachment(path) {
    try {
        const { data, error } = await db.storage.from('review-attachments').createSignedUrl(path, 60);
        if (error) throw error;
        window.open(data.signedUrl, '_blank');
    } catch (e) {
        showToast('Error generating download link', 'error');
    }
}

async function loadAdminJournals() {
    try {
        const { data, error } = await db.from('journals').select('*').order('year', { ascending: false });
        if (error) throw error;
        const c = document.getElementById('adminJournalList');
        if (!data || !data.length) { c.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted);">No journals yet.</p>'; return; }
        c.innerHTML = `<table><thead><tr><th>Title</th><th>Authors</th><th>Actions</th></tr></thead><tbody>${data.map(j => `<tr><td>${j.title}</td><td>${j.authors}</td><td><div class="actions"><button class="delete-btn" onclick="deleteJournal('${j.id}')">Delete</button></div></td></tr>`).join('')}</tbody></table>`;
    } catch (e) { document.getElementById('adminJournalList').innerHTML = '<p style="color:red;">Error loading</p>'; }
}

async function loadAdminFaculty() {
    try {
        const { data, error } = await db.from('faculty').select('*').order('display_order', { ascending: true });
        if (error) throw error;
        const c = document.getElementById('adminFacultyList');
        if (!data || !data.length) { c.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted);">No faculty yet.</p>'; return; }
        c.innerHTML = `<table><thead><tr><th>Name</th><th>Title</th><th>Actions</th></tr></thead><tbody>${data.map(f => `<tr><td>${f.name}</td><td>${f.title}</td><td><div class="actions"><button class="delete-btn" onclick="deleteFaculty('${f.id}')">Delete</button></div></td></tr>`).join('')}</tbody></table>`;
    } catch (e) { document.getElementById('adminFacultyList').innerHTML = '<p style="color:red;">Error loading</p>'; }
}

async function loadAdminNews() {
    try {
        const { data, error } = await db.from('news_events').select('*').order('date', { ascending: false });
        if (error) throw error;
        const c = document.getElementById('adminNewsList');
        if (!data || !data.length) { c.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted);">No news yet.</p>'; return; }
        c.innerHTML = `<table><thead><tr><th>Title</th><th>Type</th><th>Actions</th></tr></thead><tbody>${data.map(n => `<tr><td>${n.title}</td><td>${n.type}</td><td><div class="actions"><button class="delete-btn" onclick="deleteNews('${n.id}')">Delete</button></div></td></tr>`).join('')}</tbody></table>`;
    } catch (e) { document.getElementById('adminNewsList').innerHTML = '<p style="color:red;">Error loading</p>'; }
}

async function loadAdminProgrammes() {
    try {
        const { data, error } = await db.from('programmes').select('*').order('level', { ascending: true });
        if (error) throw error;
        const c = document.getElementById('adminProgrammesList');
        if (!data || !data.length) { c.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted);">No programmes yet.</p>'; return; }
        c.innerHTML = `<table><thead><tr><th>Title</th><th>Level</th><th>Actions</th></tr></thead><tbody>${data.map(p => `<tr><td>${p.title}</td><td>${p.level}</td><td><div class="actions"><button class="delete-btn" onclick="deleteProgramme('${p.id}')">Delete</button></div></td></tr>`).join('')}</tbody></table>`;
    } catch (e) { document.getElementById('adminProgrammesList').innerHTML = '<p style="color:red;">Error loading</p>'; }
}

// ─── ADMIN CRUD ──────────────────────────────────────

async function adminSaveJournal(e) {
    e.preventDefault();
    try {
        const title = document.getElementById('ajTitle').value;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const pdfUrl = document.getElementById('ajPdfUrl').value;
        const { error } = await db.from('journals').insert({
            title, slug,
            authors: document.getElementById('ajAuthors').value,
            abstract: document.getElementById('ajAbstract').value,
            volume: parseInt(document.getElementById('ajVolume').value),
            issue: document.getElementById('ajIssue').value ? parseInt(document.getElementById('ajIssue').value) : null,
            year: parseInt(document.getElementById('ajYear').value),
            published_date: document.getElementById('ajDate').value,
            tags: document.getElementById('ajTags').value.split(',').map(t => t.trim()).filter(Boolean),
            pdf_url: pdfUrl || null
        });
        if (error) throw error;
        showToast('Journal created!', 'success');
        document.getElementById('adminJournalForm').querySelector('form').reset();
        hideAdminForm('journal');
        loadAdminJournals();
    } catch (e) { showToast(e.message || 'Error creating journal', 'error'); }
}

async function deleteJournal(id) {
    if (!confirm('Delete this journal?')) return;
    try {
        await db.from('journals').delete().eq('id', id);
        showToast('Journal deleted', 'success');
        loadAdminJournals();
    } catch (e) { showToast('Error deleting', 'error'); }
}

async function adminSaveFaculty(e) {
    e.preventDefault();
    try {
        const photoUrl = document.getElementById('afPhoto').value;
        const { error } = await db.from('faculty').insert({
            name: document.getElementById('afName').value,
            title: document.getElementById('afTitle').value,
            specialization: document.getElementById('afSpecialization').value,
            email: document.getElementById('afEmail').value || null,
            office: document.getElementById('afOffice').value || null,
            photo_url: photoUrl || null,
            display_order: 0
        });
        if (error) throw error;
        showToast('Faculty added!', 'success');
        document.getElementById('adminFacultyForm').querySelector('form').reset();
        hideAdminForm('faculty');
        loadAdminFaculty();
    } catch (e) { showToast(e.message || 'Error creating faculty', 'error'); }
}

async function deleteFaculty(id) {
    if (!confirm('Delete this faculty member?')) return;
    try {
        await db.from('faculty').delete().eq('id', id);
        showToast('Faculty deleted', 'success');
        loadAdminFaculty();
    } catch (e) { showToast('Error deleting', 'error'); }
}

async function adminSaveNews(e) {
    e.preventDefault();
    try {
        const title = document.getElementById('anTitle').value;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const imageUrl = document.getElementById('anImage').value;
        const { error } = await db.from('news_events').insert({
            title, slug,
            type: document.getElementById('anType').value,
            date: document.getElementById('anDate').value,
            description: document.getElementById('anDescription').value,
            image_url: imageUrl || null
        });
        if (error) throw error;
        showToast('News created!', 'success');
        document.getElementById('adminNewsForm').querySelector('form').reset();
        hideAdminForm('news');
        loadAdminNews();
    } catch (e) { showToast(e.message || 'Error creating news', 'error'); }
}

async function deleteNews(id) {
    if (!confirm('Delete this news item?')) return;
    try {
        await db.from('news_events').delete().eq('id', id);
        showToast('News deleted', 'success');
        loadAdminNews();
    } catch (e) { showToast('Error deleting', 'error'); }
}

async function adminSaveProgramme(e) {
    e.preventDefault();
    try {
        const { error } = await db.from('programmes').insert({
            title: document.getElementById('apTitle').value,
            level: document.getElementById('apLevel').value,
            description: document.getElementById('apDescription').value,
            duration: document.getElementById('apDuration').value || null
        });
        if (error) throw error;
        showToast('Programme created!', 'success');
        document.getElementById('adminProgrammeForm').querySelector('form').reset();
        hideAdminForm('programme');
        loadAdminProgrammes();
    } catch (e) { showToast(e.message || 'Error creating programme', 'error'); }
}

async function deleteProgramme(id) {
    if (!confirm('Delete this programme?')) return;
    try {
        await db.from('programmes').delete().eq('id', id);
        showToast('Programme deleted', 'success');
        loadAdminProgrammes();
    } catch (e) { showToast('Error deleting', 'error'); }
}

// ─── ADMIN SETTINGS ─────────────────────────────────

async function adminSaveSettings(e) {
    e.preventDefault();
    try {
        const settings = [
            { key: 'site_name', value: document.getElementById('setSiteName').value },
            { key: 'site_tagline', value: document.getElementById('setTagline').value },
            { key: 'submission_deadline', value: document.getElementById('setSubmissionDeadline').value || '' },
            { key: 'submission_email', value: document.getElementById('setSubmissionEmail').value || 'kjsss@kasu.edu.ng' },
            { key: 'site_logo_url', value: document.getElementById('setSiteLogoUrl').value || '' }
        ];
        for (const s of settings) {
            await db.from('settings').upsert({ key: s.key, value: s.value, type: 'text' });
        }
        siteSettings.submission_deadline = document.getElementById('setSubmissionDeadline').value || null;
        siteSettings.submission_email = document.getElementById('setSubmissionEmail').value || 'kjsss@kasu.edu.ng';
        siteSettings.site_logo_url = document.getElementById('setSiteLogoUrl').value || null;

        // Admin's own name/title/photo live on their profiles row
        if (adminSession) {
            await db.from('profiles').update({
                full_name: document.getElementById('setAdminName').value || null,
                title: document.getElementById('setAdminTitle').value || null,
                avatar_url: document.getElementById('setAdminAvatarUrl').value || null
            }).eq('id', adminSession.user.id);
            loadAdminIdentity();
        }

        showToast('Settings saved! It will show on the live site next page load.', 'success');
    } catch (e) { showToast(e.message || 'Error saving settings', 'error'); }
}
