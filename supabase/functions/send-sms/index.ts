// supabase/functions/send-sms/index.ts
//
// Sends a single SMS via whatever generic REST gateway this deployment
// uses (see sendSms() in index.html — appointment reminders, result-ready
// notices). Previously sendSms() called the SMS gateway directly from the
// browser with a Bearer token read out of localStorage (CFG.smsApiKey),
// which meant the provider's API key sat in clear text in every staff
// member's browser storage. CodeQL flagged this (js/clear-text-storage-of-
// sensitive-data) — the fix is the same pattern already used for
// create-staff-account (service_role) and reception-shift-notify
// (RESEND_API_KEY): keep the secret server-side only, in an Edge Function.
//
// index.html's sendSms() now calls this via
//   sb.functions.invoke('send-sms', {body:{to, message, sender}})
// and keeps doing its own offline-safe sms_log write and toast — this
// function is a thin, authenticated proxy to the actual gateway, nothing
// else.
//
// DEPLOY:
//   supabase functions deploy send-sms
//   supabase secrets set SMS_API_URL=https://api.yourprovider.com/sms/send
//   supabase secrets set SMS_API_KEY=your_provider_api_key
//   supabase secrets set SMS_SENDER_ID=FriendshipHosp   (optional — a
//     sender id passed in the request body overrides this default)
//
// The request body shape sent to SMS_API_URL ({to, message, sender} as
// JSON with a Bearer token) matches most SMS gateway APIs directly, but
// isn't guaranteed to match whichever specific provider ends up
// configured — adjust the fetch() body/headers below to match that
// provider's actual API once chosen, same caveat as sendSms() always had.
//
// If SMS_API_URL/SMS_API_KEY aren't set, this returns a clear 500 rather
// than silently pretending to send.

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
  const SMS_API_URL = Deno.env.get("SMS_API_URL");
  const SMS_API_KEY = Deno.env.get("SMS_API_KEY");
  const SMS_SENDER_ID = Deno.env.get("SMS_SENDER_ID") || "";
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured: missing Supabase environment" }, 500);
  }

  // Any authenticated staff member may trigger this (appointment reminders,
  // result-ready notices are sent by reception/lab staff, not just admins)
  // — this just requires a real logged-in session so an unauthenticated
  // caller can't use this function to spam arbitrary numbers.
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
  // reports whether SMS_API_URL/SMS_API_KEY are set — without sending a
  // real SMS to anyone.
  if (body.ping === true) {
    if (!SMS_API_URL || !SMS_API_KEY) {
      return json({ error: "SMS provider not configured — set SMS_API_URL and SMS_API_KEY via `supabase secrets set`" }, 500);
    }
    return json({ ok: true, ping: true });
  }

  const to = String(body.to || "").trim();
  const message = String(body.message || "").trim();
  const sender = body.sender ? String(body.sender) : SMS_SENDER_ID;
  if (!to) return json({ error: "to is required" }, 400);
  if (!message) return json({ error: "message is required" }, 400);

  if (!SMS_API_URL || !SMS_API_KEY) {
    return json({ error: "SMS provider not configured — set SMS_API_URL and SMS_API_KEY via `supabase secrets set`" }, 500);
  }

  try {
    const res = await fetch(SMS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SMS_API_KEY}` },
      body: JSON.stringify({ to, message, sender: sender || undefined }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return json({ error: `SMS provider returned HTTP ${res.status}: ${errText}` }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: "Failed to send SMS: " + (e instanceof Error ? e.message : "unknown error") }, 500);
  }
});
