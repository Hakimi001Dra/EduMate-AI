// supabase/functions/notify-submission/index.js
//
// Triggered by a Supabase Database Webhook on INSERT into `submissions`.
// Sends an email to the admin/HOD via Resend (https://resend.com) so they
// know a new manuscript needs to be reviewed.
//
// Deploy with:  supabase functions deploy notify-submission
// Secrets needed (set once via `supabase secrets set KEY=value`):
//   RESEND_API_KEY       - from resend.com dashboard
//   ADMIN_NOTIFY_EMAIL   - e.g. abdul.jaafar@kasu.edu.ng
//   NOTIFY_FROM_EMAIL    - defaults to Resend's test sender if unset
//   SITE_ADMIN_URL       - e.g. https://sociology-kasu.com.ng/admin.html

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ADMIN_EMAIL = Deno.env.get("ADMIN_NOTIFY_EMAIL");
const FROM_EMAIL = Deno.env.get("NOTIFY_FROM_EMAIL") || "onboarding@resend.dev";
const SITE_URL = Deno.env.get("SITE_ADMIN_URL") || "https://sociology-kasu.com.ng/admin.html";

function escapeHtml(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

serve(async (req) => {
  try {
    const payload = await req.json();
    // Supabase Database Webhooks send: { type: "INSERT", table, record, old_record, schema }
    const record = payload.record;

    if (!record) {
      return new Response(JSON.stringify({ error: "No record in payload" }), { status: 400 });
    }

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color:#1A4731;">📄 New Manuscript Submission</h2>
        <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding:6px 0; font-weight:bold; width:140px;">Title</td><td>${escapeHtml(record.title)}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">Author(s)</td><td>${escapeHtml(record.author_name)}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">Email</td><td>${escapeHtml(record.email)}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">Research Area</td><td>${escapeHtml(record.research_area || "—")}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">Keywords</td><td>${escapeHtml(record.keywords || "—")}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">AI Tools Disclosed</td><td>${escapeHtml(record.ai_tools_disclosure || "None stated")}</td></tr>
          <tr><td style="padding:6px 0; font-weight:bold;">Manuscript File</td><td>${record.manuscript_path ? escapeHtml(record.manuscript_filename || "Attached") : "No file uploaded"}</td></tr>
        </table>
        <p style="font-weight:bold;">Abstract</p>
        <p style="color:#333; line-height:1.6;">${escapeHtml(record.abstract)}</p>
        <p style="margin-top:24px;">
          <a href="${SITE_URL}" style="background:#C8941A;color:#1A4731;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">
            Open Admin Dashboard →
          </a>
        </p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [ADMIN_EMAIL],
        subject: `New submission: ${record.title}`,
        html: emailHtml,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend API error:", errText);
      return new Response(JSON.stringify({ error: errText }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (e) {
    console.error("Function error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
