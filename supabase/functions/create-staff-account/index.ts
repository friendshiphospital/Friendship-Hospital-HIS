// supabase/functions/create-staff-account/index.ts
//
// Atomic staff account creation: create the Supabase Auth user AND the
// linked `staff` row in one server-side operation, so a staff row can
// never exist without a matching auth account, or vice versa.
//
// WHY THIS EXISTS (see CLAUDE.md / the staff module in index.html):
// the previous flow was two disconnected manual steps — invite a user via
// the Supabase dashboard, then separately paste their UUID into the app's
// Staff module. If that second step was skipped, forgotten, or the UUID
// was mistyped, the resulting staff.user_id either stayed null or pointed
// at nothing — and loadProfile() in index.html used to silently treat a
// missing/unlinked staff row as role:'admin' (now fixed to fail closed
// instead). This function closes the actual gap: there is no longer a
// window where an auth account exists with no role, or a role exists with
// no login.
//
// This MUST run server-side. Creating an auth user with a set password
// requires the Supabase service_role key, which must never be shipped in
// index.html (client-side code only ever uses the anon key — see
// CLAUDE.md's security notes). Edge Functions are the only place in this
// project's architecture where service_role is legitimate to use.
//
// DEPLOY:
//   supabase functions deploy create-staff-account
// No extra secrets to set — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// injected automatically into every Edge Function's environment by the
// platform.
//
// CALL (from index.html, already signed in as an admin):
//   const { data, error } = await sb.functions.invoke('create-staff-account', {
//     body: { full_name, email, password, role, department, phone, national_id, hire_date, qualifications }
//   });
// supabase-js attaches the caller's current session JWT to the request
// automatically — that JWT is what this function verifies server-side
// below. Nothing about "is this caller an admin" is ever trusted from the
// request body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ROLES = [
  "admin", "doctor", "nurse", "lab_tech", "lab_supervisor",
  "receptionist", "cashier", "theatre_nurse", "radiologist",
];

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
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured: missing Supabase environment" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  // service_role client for every privileged operation below (user creation,
  // staff insert, rollback). Never exposed to the caller — this only ever
  // lives inside this function's server-side execution.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Separate client scoped to the CALLER's own JWT, used only to find out
  // who is calling — never for privileged writes.
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller) return json({ error: "Not authenticated" }, 401);

  // Verify admin server-side against the staff table itself — the request
  // body's role/permissions are never trusted for this check.
  const { data: callerStaff, error: callerStaffErr } = await admin
    .from("staff")
    .select("role")
    .eq("user_id", caller.id)
    .maybeSingle();
  if (callerStaffErr || !callerStaff || callerStaff.role !== "admin") {
    return json({ error: "Forbidden — admin role required" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const full_name = String(body.full_name || "").trim();
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  const role = String(body.role || "");
  const department = body.department ? String(body.department) : null;
  const phone = body.phone ? String(body.phone) : null;
  const national_id = body.national_id ? String(body.national_id) : null;
  const hire_date = body.hire_date ? String(body.hire_date) : null;
  const qualifications = body.qualifications ? String(body.qualifications) : null;

  if (!full_name || !email || !password || !role) {
    return json({ error: "full_name, email, password, and role are required" }, 400);
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return json({ error: "Invalid role: " + role }, 400);
  }
  if (password.length < 8) {
    return json({ error: "Password must be at least 8 characters" }, 400);
  }

  // Step 1: create the auth user.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    return json({ error: "Failed to create auth user: " + (createErr?.message || "unknown error") }, 400);
  }

  // Step 2: insert the staff row, linked to that new auth user, in the
  // same request. If this fails, roll back the auth user rather than
  // leaving an orphaned login with no role.
  const { data: staffRow, error: staffErr } = await admin
    .from("staff")
    .insert({
      full_name,
      role,
      department,
      phone,
      email,
      national_id,
      hire_date,
      qualifications,
      status: "active",
      user_id: created.user.id,
    })
    .select()
    .single();

  if (staffErr) {
    const { error: rollbackErr } = await admin.auth.admin.deleteUser(created.user.id);
    if (rollbackErr) {
      // Worst case: both operations failed to reconcile. Surface this
      // distinctly so an admin knows to check Supabase Auth manually
      // rather than assuming the rollback silently worked.
      return json({
        error: "Failed to create staff row AND failed to roll back the auth user — " +
          "manually check/delete auth user " + created.user.id + " in the Supabase dashboard. " +
          "Staff error: " + staffErr.message + " | Rollback error: " + rollbackErr.message,
      }, 500);
    }
    return json({ error: "Failed to create staff row (auth user rolled back): " + staffErr.message }, 400);
  }

  return json({ ok: true, staff: staffRow });
});
