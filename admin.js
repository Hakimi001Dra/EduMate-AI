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
async function init() {
    try {
        await initSupabaseWithRetry();
        initFileUploads();

        const { data } = await db.auth.getSession();
        if (data.session) {
            adminSession = data.session;
            showAdminDashboardView();
            loadAdminDashboard();
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
        adminSession = data.session;
        err.style.display = 'none';
        showToast('Login successful!', 'success');
        showAdminDashboardView();
        loadAdminDashboard();
    } catch (e) { err.textContent = e.message || 'Invalid credentials'; err.style.display = 'block'; }
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
}

async function loadAdminSubmissions() {
    try {
        const { data, error } = await db.from('submissions').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        const c = document.getElementById('adminSubmissionsList');
        if (!data || !data.length) { c.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted);">No submissions yet.</p>'; return; }
        c.innerHTML = `<table><thead><tr><th>Title</th><th>Author</th><th>Email</th><th>Area</th><th>File</th><th>Status</th><th>Actions</th></tr></thead><tbody>${data.map(s => `
            <tr>
                <td>${s.title}</td>
                <td>${s.author_name}</td>
                <td>${s.email}</td>
                <td>${s.research_area || '—'}</td>
                <td>${s.manuscript_path ? `<button class="edit-btn" style="padding:4px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;" onclick="downloadManuscript('${s.manuscript_path}')">📄 Download</button>` : '—'}</td>
                <td>${s.status}</td>
                <td><div class="actions">
                    <button class="edit-btn" onclick="updateSubmissionStatus('${s.id}','in_review')">In Review</button>
                    <button class="edit-btn" onclick="updateSubmissionStatus('${s.id}','accepted')">Accept</button>
                    <button class="delete-btn" onclick="updateSubmissionStatus('${s.id}','rejected')">Reject</button>
                    <button class="edit-btn" onclick="resendSubmissionNotification('${s.id}')">🔔 Notify</button>
                    <button class="edit-btn" onclick="publishSubmissionToJournal('${s.id}')">📰 Publish</button>
                    <button class="delete-btn" onclick="deleteSubmission('${s.id}', ${s.manuscript_path ? `'${s.manuscript_path}'` : 'null'})">🗑️ Delete</button>
                </div></td>
            </tr>`).join('')}</tbody></table>`;
    } catch (e) { document.getElementById('adminSubmissionsList').innerHTML = '<p style="color:red;">Error loading submissions</p>'; }
}

// Manually re-sends the "new submission" admin notification email for a
// submission — useful if the automatic one (sent right after the author
// submits) failed for any reason.
async function resendSubmissionNotification(id) {
    try {
        const { data: record, error } = await db.from('submissions').select('*').eq('id', id).single();
        if (error) throw error;
        await withTimeout(db.functions.invoke('notify-submission', { body: { record } }), 10000);
        showToast('Notification email sent', 'success');
    } catch (e) {
        showToast('Could not send notification: ' + (e.message || 'unknown error'), 'error');
    }
}

async function downloadManuscript(path) {
    try {
        const { data, error } = await db.storage.from('manuscripts').createSignedUrl(path, 60);
        if (error) throw error;
        window.open(data.signedUrl, '_blank');
    } catch (e) { showToast('Error generating download link', 'error'); }
}

// Updates a submission's status, then emails the AUTHOR to let them know.
// .select().single() is safe here (unlike the anon insert case) because
// logged-in admins already have a SELECT policy on submissions.
async function updateSubmissionStatus(id, status) {
    try {
        const { data: updated, error } = await db.from('submissions').update({ status }).eq('id', id).select().single();
        if (error) throw error;
        showToast(`Marked as ${status}`, 'success');

        // Notify the author of the status change. If this fails (e.g. Resend
        // not configured yet), the status update itself still succeeded —
        // we just log it rather than blocking the admin action.
        try {
            await withTimeout(db.functions.invoke('notify-submission', { body: { type: 'status_update', record: updated } }), 10000);
        } catch (notifyErr) {
            console.warn('Status updated, but author notification failed:', notifyErr.message);
        }

        loadAdminSubmissions();
        loadAdminDashboard();
    } catch (e) { showToast('Error updating status', 'error'); }
}

// Copies an accepted submission's manuscript file from the private
// "manuscripts" bucket into the public "journal-pdfs" bucket, and creates
// a matching row in the "journals" table so it appears on the main site.
// Prompts for volume/year since submissions don't collect those.
async function publishSubmissionToJournal(id) {
    try {
        const { data: sub, error } = await db.from('submissions').select('*').eq('id', id).single();
        if (error) throw error;

        if (sub.status !== 'accepted') {
            if (!confirm(`This submission is currently "${sub.status}", not "accepted". Publish anyway?`)) return;
        }

        const volume = prompt('Volume number for this issue:', '');
        if (volume === null) return; // cancelled
        const year = prompt('Publication year:', String(new Date().getFullYear()));
        if (year === null) return; // cancelled

        let pdfUrl = null;
        if (sub.manuscript_path) {
            const { data: fileBlob, error: dlErr } = await db.storage.from('manuscripts').download(sub.manuscript_path);
            if (dlErr) throw new Error('Could not download manuscript: ' + dlErr.message);

            const destPath = `published_${Date.now()}_${sub.manuscript_filename || 'manuscript.docx'}`;
            const { error: upErr } = await db.storage.from('journal-pdfs').upload(destPath, fileBlob, { upsert: false });
            if (upErr) throw new Error('Could not copy manuscript to public journals bucket: ' + upErr.message);

            const { data: { publicUrl } } = db.storage.from('journal-pdfs').getPublicUrl(destPath);
            pdfUrl = publicUrl;
        }

        const title = sub.title;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
        const tags = sub.research_area ? [sub.research_area] : [];

        const { error: insErr } = await db.from('journals').insert({
            title,
            slug,
            authors: sub.author_name,
            abstract: sub.abstract,
            volume: parseInt(volume) || 1,
            year: parseInt(year) || new Date().getFullYear(),
            published_date: new Date().toISOString().slice(0, 10),
            tags,
            pdf_url: pdfUrl
        });
        if (insErr) throw insErr;

        showToast('Published to Journals!', 'success');
        loadAdminJournals();
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
        showToast('Settings saved! It will show on the live site next page load.', 'success');
    } catch (e) { showToast(e.message || 'Error saving settings', 'error'); }
}
