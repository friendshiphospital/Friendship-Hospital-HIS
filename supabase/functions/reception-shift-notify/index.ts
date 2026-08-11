// supabase/functions/reception-shift-notify/index.ts
//
// Sends the "[Shift Opened]" / "[Shift Closed]" admin notification emails
// for the Reception Shift Management module (see the shift-bar / Open
// Shift / Close Shift code in index.html — dispatchShiftEmail() calls this
// via sb.functions.invoke('reception-shift-notify', {body:{kind, shift, admin_email}})
// right after a shift is opened or closed).
//
// WHY AN EDGE FUNCTION (not a direct fetch() from index.html):
// the email provider's API key must never be shipped client-side (same
// reason create-staff-account uses the service_role key server-side only
// — see that function's comments and CLAUDE.md's security notes). Sending
// email from the browser directly would mean embedding a secret in a
// static HTML/JS file that any staff member's browser can read.
//
// EMAIL PROVIDER: Resend (https://resend.com) — a simple "POST JSON with a
// Bearer token" HTTP API, the same shape sendSms() already uses for the
// SMS gateway (see index.html), just swapped to Resend's actual endpoint.
// Swap RESEND_API_URL/the fetch body below if a different provider
// (SendGrid, Postmark, SES, etc.) is preferred — nothing else in this
// function depends on Resend specifically.
//
// DEPLOY:
//   supabase functions deploy reception-shift-notify
//   supabase secrets set RESEND_API_KEY=re_your_key_here
//   supabase secrets set EMAIL_FROM="Friendship Hospital HIS <noreply@yourdomain.com>"
// (EMAIL_FROM must be a domain verified with your email provider — an
// unverified From address will be rejected by Resend.)
//
// If RESEND_API_KEY isn't set, this function returns a clear 500 rather
// than silently pretending to send — dispatchShiftEmail() in index.html
// is called without awaiting it in the UI's critical path either way, so
// a misconfigured/unreachable email endpoint never blocks opening or
// closing a shift, it only surfaces a toast warning.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}
function money(v: unknown): string {
  const n = Number(v) || 0;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDateTime(v: unknown): string {
  if (!v) return "—";
  try {
    return new Date(v as string).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(v); }
}
function durationLabel(openedAt: unknown, closedAt: unknown): string {
  if (!openedAt || !closedAt) return "—";
  const ms = new Date(closedAt as string).getTime() - new Date(openedAt as string).getTime();
  if (!(ms > 0)) return "—";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h + "h " + m + "m";
}

// Shared HTML chrome so both templates look like one system — a plain
// table-based layout (not flexbox/grid) since email clients render those
// far more reliably than modern CSS.
function emailShell(title: string, accent: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#0e1928">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.06)">
  <tr><td style="background:${accent};padding:20px 28px">
    <div style="color:#fff;font-size:12px;letter-spacing:.5px;text-transform:uppercase;opacity:.85">Friendship Hospital — Al Damazin</div>
    <div style="color:#fff;font-size:20px;font-weight:700;margin-top:4px">${esc(title)}</div>
  </td></tr>
  <tr><td style="padding:24px 28px">${bodyHtml}</td></tr>
  <tr><td style="padding:16px 28px;background:#f8fafd;border-top:1px solid #e2e8f3;color:#64748b;font-size:11px">
    Automated notification from the Friendship Hospital HIS Reception Shift Management module. Blue Nile State, Sudan.
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
function infoRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#64748b;font-size:13px;width:45%">${esc(label)}</td>
    <td style="padding:6px 0;font-weight:600;font-size:13px">${value}</td>
  </tr>`;
}
function kpiCell(n: string, l: string): string {
  return `<td align="center" style="background:#f4f7fb;border-radius:8px;padding:14px 8px">
    <div style="font-size:20px;font-weight:800;color:#0b7a75">${esc(n)}</div>
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#64748b;margin-top:2px">${esc(l)}</div>
  </td>`;
}

function buildOpenEmail(shift: Record<string, unknown>) {
  const staffName = shift.staff_name || "—";
  const shiftType = shift.shift_type || "—";
  const subject = `[Shift Opened] Reception Shift Started - ${staffName} (${shiftType})`;
  const body = `
    <p style="font-size:14px;margin:0 0 16px">A new reception shift has been opened.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${infoRow("Staff Name", esc(staffName))}
      ${infoRow("Shift ID", esc(shift.shift_no))}
      ${infoRow("Shift Type", esc(String(shiftType).toUpperCase()))}
      ${infoRow("Station / Counter ID", esc(shift.station_id))}
      ${infoRow("Opening Float Balance", `${money(shift.opening_float)} ${esc(shift.currency || "SDG")}`)}
      ${infoRow("Opened At", fmtDateTime(shift.opened_at))}
    </table>`;
  return { subject, html: emailShell("🟢 Reception Shift Opened", "linear-gradient(120deg,#0b7a75,#0e5a56)", body) };
}

function buildCloseEmail(shift: Record<string, unknown>) {
  const staffName = shift.staff_name || "—";
  const dateLabel = shift.closed_at ? new Date(shift.closed_at as string).toLocaleDateString("en-GB") : "—";
  const subject = `[Shift Closed] Reception Shift Summary - ${staffName} (${dateLabel})`;
  const variance = Number(shift.cash_variance) || 0;
  const varianceColor = Math.abs(variance) < 0.01 ? "#166534" : (variance > 0 ? "#166534" : "#b91c1c");
  const varianceLabel = (variance >= 0 ? "+" : "") + money(variance) + " SDG";
  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px">
      ${infoRow("Shift ID", esc(shift.shift_no))}
      ${infoRow("Staff Name", esc(staffName))}
      ${infoRow("Station / Counter ID", esc(shift.station_id))}
      ${infoRow("Opened", fmtDateTime(shift.opened_at))}
      ${infoRow("Closed", fmtDateTime(shift.closed_at))}
      ${infoRow("Duration", durationLabel(shift.opened_at, shift.closed_at))}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="8">
      <tr>
        ${kpiCell(String(shift.total_patients ?? 0), "Patients")}
        ${kpiCell(money(shift.gross_revenue) + " SDG", "Gross Revenue")}
        ${kpiCell(money(shift.total_cash) + " SDG", "Net Cash Collected")}
      </tr>
    </table>
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#64748b;margin:18px 0 8px">Payment Method Breakdown</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr style="background:#1e3a5a"><td style="padding:6px 10px;color:#fff;font-size:12px">Method</td><td style="padding:6px 10px;color:#fff;font-size:12px;text-align:right">Amount (SDG)</td></tr>
      <tr><td style="padding:6px 10px;font-size:13px;border-bottom:1px solid #f1f5fb">💵 Cash</td><td style="padding:6px 10px;font-size:13px;text-align:right;border-bottom:1px solid #f1f5fb">${money(shift.total_cash)}</td></tr>
      <tr><td style="padding:6px 10px;font-size:13px;border-bottom:1px solid #f1f5fb">💳 Card</td><td style="padding:6px 10px;font-size:13px;text-align:right;border-bottom:1px solid #f1f5fb">${money(shift.total_card)}</td></tr>
      <tr><td style="padding:6px 10px;font-size:13px;border-bottom:1px solid #f1f5fb">🏥 Insurance</td><td style="padding:6px 10px;font-size:13px;text-align:right;border-bottom:1px solid #f1f5fb">${money(shift.total_insurance)}</td></tr>
      <tr><td style="padding:6px 10px;font-size:13px;border-bottom:1px solid #f1f5fb">👛 Wallet</td><td style="padding:6px 10px;font-size:13px;text-align:right;border-bottom:1px solid #f1f5fb">${money(shift.total_wallet)}</td></tr>
      <tr><td style="padding:6px 10px;font-size:13px;border-bottom:1px solid #f1f5fb">🌐 Online / Mobile / Bank</td><td style="padding:6px 10px;font-size:13px;text-align:right;border-bottom:1px solid #f1f5fb">${money(shift.total_online)}</td></tr>
      <tr><td style="padding:6px 10px;font-size:13px;color:#b91c1c">↩ Discounts / Refunds</td><td style="padding:6px 10px;font-size:13px;text-align:right;color:#b91c1c">-${money(shift.total_refunds)}</td></tr>
    </table>
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#64748b;margin:18px 0 8px">Financial Reconciliation</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;border-radius:8px">
      <tr><td style="padding:14px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${infoRow("Opening Float", money(shift.opening_float) + " SDG")}
          ${infoRow("Expected Cash Balance", money(shift.cash_expected) + " SDG")}
          ${infoRow("Actual Cash Counted", money(shift.cash_actual) + " SDG")}
        </table>
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f3;display:flex;justify-content:space-between">
          <span style="font-size:13px;font-weight:700">Cash Variance</span>
          <span style="font-size:13px;font-weight:800;color:${varianceColor}">${varianceLabel}</span>
        </div>
        ${shift.variance_reason ? `<div style="margin-top:6px;font-size:12px;color:#64748b">Reason: ${esc(shift.variance_reason)}</div>` : ""}
      </td></tr>
    </table>
    ${shift.closing_notes ? `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#64748b;margin:18px 0 6px">Handover / Closure Notes</div>
    <div style="font-size:13px;background:#fef9c3;border-radius:8px;padding:10px 14px;color:#78350f">${esc(shift.closing_notes)}</div>` : ""}
  `;
  return { subject, html: emailShell("🔒 Reception Shift Closed — Z-Report", "linear-gradient(120deg,#941e1e,#1e293b)", body) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "Friendship Hospital HIS <noreply@friendshiphospital.example>";
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured: missing Supabase environment" }, 500);
  }

  // Any authenticated staff member may trigger this (receptionists open/
  // close their own shifts) — unlike create-staff-account, this isn't
  // admin-gated, it just requires a real logged-in session so an
  // unauthenticated caller can't spam the admin inbox.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller) return json({ error: "Not authenticated" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Health-check ping (Settings → Edge Function Health Check, index.html):
  // proves the function is deployed, reachable, and authenticated, and
  // reports whether RESEND_API_KEY is set — without sending a real email.
  if (body.ping === true) {
    if (!RESEND_API_KEY) {
      return json({ error: "Email provider not configured — set RESEND_API_KEY via `supabase secrets set`" }, 500);
    }
    return json({ ok: true, ping: true });
  }

  const kind = String(body.kind || "");
  const shift = (body.shift || {}) as Record<string, unknown>;
  const adminEmail = String(body.admin_email || "admin@hospital.com").trim();
  if (kind !== "open" && kind !== "close") return json({ error: "kind must be 'open' or 'close'" }, 400);
  if (!shift.shift_no) return json({ error: "shift payload missing shift_no" }, 400);
  if (!adminEmail) return json({ error: "admin_email is required" }, 400);

  const { subject, html } = kind === "open" ? buildOpenEmail(shift) : buildCloseEmail(shift);

  if (!RESEND_API_KEY) {
    return json({ error: "Email provider not configured — set RESEND_API_KEY via `supabase secrets set`" }, 500);
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: EMAIL_FROM, to: [adminEmail], subject, html }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return json({ error: `Email provider returned HTTP ${res.status}: ${errText}` }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: "Failed to send email: " + (e instanceof Error ? e.message : "unknown error") }, 500);
  }
});
