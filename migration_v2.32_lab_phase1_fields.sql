-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.32_lab_phase1_fields.sql
-- Documentation/Logbook expansion, Phase 1 (Laboratory)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1. qc_lots.analyte — required to compute a Six Sigma metric (Sigma =
--    (TEa - |Bias|) / %CV), since TEa is analyte-specific (a TEa
--    reference table lives client-side in index.html as
--    TEA_REFERENCE_DEFAULTS, editable via Settings). control_name is a
--    free-text product name (e.g. "Bio-Rad Level 1") and is NOT reliably
--    matchable to an analyte, so this is a genuinely new column, not a
--    rename.
--
-- 2. critical_values.mrn / critical_values.lab_no — snapshot the
--    patient's identifiers onto the row at the moment a critical value is
--    logged. Before this, MRN/Lab No were only ever available via a live
--    join to `patients` at read time — the panic log itself carried no
--    identifying snapshot of its own, which is a real deficiency for a
--    log whose whole purpose is being an durable, self-contained record
--    of what was reported and to whom.
--
-- 3. critical_values.read_back_confirmed — the acknowledge flow
--    previously (openCritAck()/submitCritAck() in index.html, replacing
--    the removed acknowledgeCritical() bare-prompt() flow) required only
--    a free-text clinician name via prompt(), with placeholder text
--    claiming "(read-back confirmed)" that captured nothing. The new flow
--    requires the acknowledging user to re-type the actual reported value
--    — a real read-back, compared against the true stored value client-
--    side before the acknowledge is allowed to submit — mirroring the
--    genuine two-person MRN/unit re-entry pattern already used by Blood
--    Bank's confirmIssueStep1()/confirmIssueStep2(). This column records
--    that the check was actually performed, not just claimed.
--
-- Idempotent — safe to re-run. Not applied automatically; for manual
-- review and application in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.qc_lots
  add column if not exists analyte text;

alter table public.critical_values
  add column if not exists mrn text,
  add column if not exists lab_no text,
  add column if not exists read_back_confirmed boolean not null default false;

comment on column public.qc_lots.analyte is 'Analyte this control lot measures (e.g. Glucose, Sodium, Haemoglobin) — keys into the client-side TEa reference table for Six Sigma metric calculation. Distinct from control_name (a free-text product name).';
comment on column public.critical_values.mrn is 'Patient MRN, snapshotted at the moment the critical value was logged — not solely reliant on a live join to patients.';
comment on column public.critical_values.lab_no is 'Patient Lab No, snapshotted at the moment the critical value was logged — not solely reliant on a live join to patients.';
comment on column public.critical_values.read_back_confirmed is 'True only when the acknowledging user re-typed the actual reported value and it matched (openCritAck()/submitCritAck() in index.html) — a real read-back, not a name-only acknowledgement.';
