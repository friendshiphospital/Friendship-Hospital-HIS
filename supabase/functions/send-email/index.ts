// supabase/functions/send-email/index.ts
//
// Generic, authenticated "send one email" proxy to the Resend API — the
// same provider/secrets reception-shift-notify already uses
// (RESEND_API_KEY, EMAIL_FROM). reception-shift-notify keeps its own
// dedicated function because its email bodies are built server-side from
// a shift row; this function exists for callers that already have a
// ready-made subject/html and just need it delivered without embedding
// RESEND_API_KEY client-side (same reasoning as send-sms/
// reception-shift-notify — see those files' comments and CLAUDE.md's
// security notes).
//
// Callers (index.html):
//   sb.functions.invoke('send-email', {body:{to, subject, html}})
//   `to` may be a single address or an array of addresses.
//
// Used by:
//   - Inventory low-stock reagent alert (Admin + Lab Supervisor emails)
//   - Backup-verification alert (Admin email, failure-only)
//
// DEPLOY:
//   supabase functions deploy send-email
//   supabase secrets set RESEND_API_KEY=re_your_key_here
//   supabase secrets set EMAIL_FROM="Friendship Hospital HIS <noreply@yourdomain.com>"
// (Same RESEND_API_KEY/EMAIL_FROM secrets as reception-shift-notify — if
// that function is already configured, this one works with no extra setup.)
//
// If RESEND_API_KEY isn't set, this returns a clear 500 rather than
// silently pretending to send.

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

  // Any authenticated staff member may trigger this — same posture as
  // send-sms/reception-shift-notify: not admin-gated, just requires a
  // real logged-in session so an unauthenticated caller can't use this
  // function to spam arbitrary addresses.
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

  const toRaw = body.to;
  const to = Array.isArray(toRaw)
    ? toRaw.map((v) => String(v).trim()).filter(Boolean)
    : String(toRaw || "").trim() ? [String(toRaw).trim()] : [];
  const subject = String(body.subject || "").trim();
  const html = String(body.html || "");
  if (!to.length) return json({ error: "to is required" }, 400);
  if (!subject) return json({ error: "subject is required" }, 400);
  if (!html) return json({ error: "html is required" }, 400);

  if (!RESEND_API_KEY) {
    return json({ error: "Email provider not configured — set RESEND_API_KEY via `supabase secrets set`" }, 500);
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
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
