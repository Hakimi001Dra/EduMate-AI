// ═══════════════════════════════════════════════════════════
// shared.js — code used by BOTH index.html (public) and admin.html
// Keeping this in one file means the Supabase config, upload logic,
// and toast helper only need to be maintained in one place.
// ═══════════════════════════════════════════════════════════

// ═══ Supabase project credentials ═══
const SUPABASE_URL = "https://xonqebmlxlbvvhvmhhxv.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvbnFlYm1seGxidnZodm1oaHh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMzczMTEsImV4cCI6MjEwMTYxMzMxMX0.8txFv3_7FH0XGbfXSy8A17t9xsPoGD-kCkZBARhyXQc";

let db = null;

function initSupabase() {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return db;
}

// Waits for window.supabase (the CDN library) to actually be available before
// creating the client. Protects against any script-loading timing issue —
// e.g. a slow network — that could otherwise leave `db` null while the rest
// of the page carries on and later crashes with "Cannot read properties of
// null (reading 'from')" the first time something tries to query it.
async function initSupabaseWithRetry(retries = 20, delayMs = 250) {
  for (let i = 0; i < retries; i++) {
    if (window.supabase && typeof window.supabase.createClient === "function") {
      return initSupabase();
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    "Could not load the Supabase library. Check your internet connection, or that cdn.jsdelivr.net isn't blocked, then refresh the page."
  );
}

// Shows a permanent (non-auto-hiding) red banner at the top of the page.
// Used for failures serious enough that a 5-second toast isn't enough — the
// person should see this even if they look at the page a minute later.
function showPersistentError(msg) {
  if (document.getElementById("persistentErrorBanner")) return;
  const banner = document.createElement("div");
  banner.id = "persistentErrorBanner";
  banner.style.cssText =
    "position:sticky;top:0;left:0;right:0;z-index:10000;background:#dc2626;color:#fff;padding:0.85rem 1rem;text-align:center;font-family:sans-serif;font-size:14px;";
  banner.textContent = msg;
  document.body.insertAdjacentElement("afterbegin", banner);
}

// ─── Wraps a Supabase call so a hung network request can't leave the
// page stuck on "Loading..." forever — it fails after `ms` and lets
// the caller show a retry option instead. ─────────────────────────
function withTimeout(promise, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "Request timed out. Please check your connection and try again."
            )
          ),
        ms
      )
    ),
  ]);
}

// ─── TOAST ──────────────────────────────────────────
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) {
    console.log(`[toast:${type}]`, msg);
    return;
  }
  t.textContent = msg;
  t.className = `toast toast-${type}`;
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 5000);
}

// ─── FILE UPLOAD CLASS ─────────────────────────────
class FileUpload {
  constructor(options = {}) {
    this.bucket = options.bucket || "journal-pdfs";
    this.accept = options.accept || ".pdf";
    this.label = options.label || "Upload File";
    this.onUpload = options.onUpload || (() => {});
    this.maxSize = options.maxSize || 50 * 1024 * 1024;
    this.containerId = options.containerId || "fileUploadContainer";
    this.isPrivate = options.isPrivate || false;
  }

  render() {
    return ` <div class="file-upload-wrapper"> <div class="file-upload-area"> <input type="file" id="${this.containerId}_input" accept="${this.accept}" style="display:none;" /> <button type="button" class="btn-primary" onclick="document.getElementById('${this.containerId}_input').click()"> 📁 ${this.label} </button> <div id="${this.containerId}_status" class="upload-status"></div> <div id="${this.containerId}_progress" class="progress-container"> <div class="progress-bar"> <div id="${this.containerId}_progressFill" class="progress-fill"></div> </div> <span id="${this.containerId}_progressText" class="progress-text">0%</span> </div> <div id="${this.containerId}_preview" class="file-preview"></div> </div> </div> `;
  }

  init() {
    const fileInput = document.getElementById(`${this.containerId}_input`);
    if (!fileInput) return;

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > this.maxSize) {
        alert(
          `File is too large. Maximum size is ${ this.maxSize / (1024 * 1024) }MB.`
        );
        fileInput.value = "";
        return;
      }

      const statusEl = document.getElementById(`${this.containerId}_status`);
      const progressContainer = document.getElementById(
        `${this.containerId}_progress`
      );
      const progressFill = document.getElementById(
        `${this.containerId}_progressFill`
      );
      const progressText = document.getElementById(
        `${this.containerId}_progressText`
      );
      const previewEl = document.getElementById(`${this.containerId}_preview`);

      progressContainer.style.display = "block";
      statusEl.textContent = `Uploading ${file.name}...`;

      try {
        if (!db)
          throw new Error(
            "Not connected to the server yet. Please refresh the page and try again."
          );

        const { path, url } = await withTimeout(this.uploadFile(file), 30000);

        statusEl.innerHTML = url
          ? `✅ Uploaded: <a href="${url}" target="_blank">${file.name}</a>`
          : `✅ Uploaded: ${file.name} (private — visible to reviewers only)`;
        progressFill.style.width = "100%";
        progressText.textContent = "100%";

        this.showPreview(url, file.type, file.name, previewEl);
        this.onUpload(path, url, file.name);

        setTimeout(() => {
          progressContainer.style.display = "none";
          progressFill.style.width = "0%";
          progressText.textContent = "0%";
        }, 5000);
      } catch (error) {
        statusEl.innerHTML = `❌ ${ error.message || "Upload failed" } — <button type="button" class="btn-outline-dark" style="padding:2px 10px;font-size:12px;" onclick="document.getElementById('${ this.containerId }_input').click()">Try again</button>`;
        progressContainer.style.display = "none";
        progressFill.style.width = "0%";
        progressText.textContent = "0%";
        fileInput.value = "";
      }
    });
  }

  async uploadFile(file) {
    const fileExt = file.name.split(".").pop();
    const filePath = `${Date.now()}_${Math.random() .toString(36) .slice(2, 8)}.${fileExt}`;

    const { data, error } = await db.storage
      .from(this.bucket)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      // Give a clearer hint for the most common misconfiguration
      if (/bucket.*not.*found/i.test(error.message)) {
        throw new Error(
          `Storage bucket "${this.bucket}" doesn't exist yet in Supabase — run the setup SQL first.`
        );
      }
      throw new Error(error.message);
    }

    if (this.isPrivate) {
      // Private bucket: don't request a public URL (bucket has no public access).
      return { path: filePath, url: null };
    }

    const {
      data: { publicUrl },
    } = db.storage.from(this.bucket).getPublicUrl(filePath);

    return { path: filePath, url: publicUrl };
  }

  showPreview(url, fileType, fileName, previewEl) {
    if (!url) {
      previewEl.innerHTML = `<span style="font-size:12px;color:var(--kasu-green);">📎 ${fileName} — submitted for review</span>`;
      return;
    }
    if (fileType.startsWith("image/")) {
      previewEl.innerHTML = ` <img src="${url}" alt="Preview"> <br> <a href="${url}" target="_blank" style="font-size:12px;color:var(--kasu-green);">View full image</a> `;
    } else if (fileType === "application/pdf") {
      previewEl.innerHTML = ` <a href="${url}" target="_blank" class="btn-primary" style="font-size:12px;padding:6px 12px;display:inline-block;">📄 View PDF</a> `;
    } else {
      previewEl.innerHTML = ` <a href="${url}" target="_blank" style="font-size:12px;color:var(--kasu-green);">📎 Download file</a> `;
    }
  }
}

// ─── INIT FILE UPLOADS ─────────────────────────────
function initFileUploads() {
  // PDF Upload (journal articles - public)
  const pdfContainer = document.getElementById("pdfUploadContainer");
  if (pdfContainer) {
    const pdfUpload = new FileUpload({
      bucket: "journal-pdfs",
      accept: ".pdf,.doc,.docx",
      label: "📄 Upload Article File (PDF or Word)",
      maxSize: 100 * 1024 * 1024,
      containerId: "pdfUpload",
      onUpload: (path, url) => {
        document.getElementById("ajPdfUrl").value = url;
        showToast("File uploaded successfully!", "success");
      },
    });
    pdfContainer.innerHTML = pdfUpload.render();
    pdfUpload.init();
  }

  // Photo Upload (faculty - public)
  const photoContainer = document.getElementById("photoUploadContainer");
  if (photoContainer) {
    const photoUpload = new FileUpload({
      bucket: "faculty-photos",
      accept: "image/*",
      label: "📸 Upload Photo",
      maxSize: 10 * 1024 * 1024,
      containerId: "photoUpload",
      onUpload: (path, url) => {
        document.getElementById("afPhoto").value = url;
        showToast("Photo uploaded successfully!", "success");
      },
    });
    photoContainer.innerHTML = photoUpload.render();
    photoUpload.init();
  }

  // Image Upload (news - public)
  const imageContainer = document.getElementById("imageUploadContainer");
  if (imageContainer) {
    const imageUpload = new FileUpload({
      bucket: "news-images",
      accept: "image/*",
      label: "🖼️ Upload Image",
      maxSize: 20 * 1024 * 1024,
      containerId: "imageUpload",
      onUpload: (path, url) => {
        document.getElementById("anImage").value = url;
        showToast("Image uploaded successfully!", "success");
      },
    });
    imageContainer.innerHTML = imageUpload.render();
    imageUpload.init();
  }

  // Site Logo Upload (admin settings - public bucket, so it can be shown on the live site)
  const logoContainer = document.getElementById("logoUploadContainer");
  if (logoContainer) {
    const logoUpload = new FileUpload({
      bucket: "site-branding",
      accept: "image/*",
      label: "🖼️ Upload Logo",
      maxSize: 5 * 1024 * 1024,
      containerId: "logoUpload",
      onUpload: (path, url) => {
        document.getElementById("setSiteLogoUrl").value = url;
        showToast(
          'Logo uploaded — click "Save Settings" to publish it.',
          "success"
        );
      },
    });
    logoContainer.innerHTML = logoUpload.render();
    logoUpload.init();
  }

  // Manuscript Upload — Full Submit page form (private, blind review)
  const fullManuscriptContainer = document.getElementById(
    "fullManuscriptUploadContainer"
  );
  if (fullManuscriptContainer) {
    const manuscriptUploadFull = new FileUpload({
      bucket: "manuscripts",
      accept: ".pdf,.doc,.docx",
      label: "📄 Upload Manuscript",
      maxSize: 20 * 1024 * 1024,
      containerId: "fullManuscriptUpload",
      isPrivate: true,
      onUpload: (path, url, fileName) => {
        document.getElementById("subManuscriptPathFull").value = path;
        document.getElementById("subManuscriptNameFull").value = fileName;
        showToast("Manuscript uploaded!", "success");
      },
    });
    fullManuscriptContainer.innerHTML = manuscriptUploadFull.render();
    manuscriptUploadFull.init();
  }

  // Author Profile Avatar Upload (public — shown on the author's public page)
  const avatarContainer = document.getElementById("avatarUploadContainer");
  if (avatarContainer) {
    const avatarUpload = new FileUpload({
      bucket: "author-avatars",
      accept: "image/*",
      label: "📸 Upload Photo",
      maxSize: 5 * 1024 * 1024,
      containerId: "avatarUpload",
      onUpload: (path, url) => {
        document.getElementById("profileAvatarUrl").value = url;
        showToast("Photo uploaded — click Save Profile to keep it.", "success");
      },
    });
    avatarContainer.innerHTML = avatarUpload.render();
    avatarUpload.init();
  }
}
