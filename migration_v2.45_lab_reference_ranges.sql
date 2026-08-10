-- ═══════════════════════════════════════════════════════════════════════
-- Friendship Hospital HIS — migration_v2.45_lab_reference_ranges.sql
-- Lab Reference Ranges — admin-managed ranges/units + SI/Conventional
-- unit-system toggle
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT WAS AUDITED FIRST
--   Every department's reference range (lo/hi) and unit was hardcoded in
--   RESULT_META (index.html), SI units only, read directly by
--   flagHem()/flagChem()/etc. and by every department's print*Report()
--   function (e.g. printChemReport()'s row('Creatinine',r.creat,'µmol/L',
--   62,106,RFT)). There was no admin UI to view or change a range, and no
--   way to display a Conventional/US-unit lab report at all. RESULT_META
--   only has entries for the four NUMERIC-panel departments (hem, chem,
--   sero, immuno) — micro/pcr/histo/cyto are narrative/qualitative
--   reports with no fixed numeric ranges, so they are correctly not
--   represented here either, matching how RESULT_META itself is scoped.
--
-- WHAT THIS ADDS
--   lab_reference_ranges — one row per (dept_key, field_code), i.e. one
--   row per RESULT_META entry. si_unit/si_lo/si_hi are seeded directly
--   from RESULT_META's current values below (this lab's existing, correct
--   default — SI stays unchanged by this migration or the feature it
--   enables). conventional_unit/conventional_lo/conventional_hi/
--   conversion_factor are seeded for a small set of analytes with a
--   single, unambiguous, textbook-standard SI<->Conventional conversion
--   (creatinine, glucose, urea/BUN, cholesterol group, triglycerides,
--   bilirubin group, calcium, uric acid, total protein/albumin,
--   magnesium, phosphorus, and the electrolytes — the latter needing only
--   a unit relabel to mEq/L, not a numeric change, for monovalent ions).
--   Every other field is left with conventional_* NULL on purpose — most
--   remaining fields (enzyme activities in U/L, hormones, tumour markers,
--   vitamins, eGFR, INR, HbA1c%) are either already unit-identical between
--   SI and US-conventional reporting, or have no single universally-agreed
--   conversion factor worth guessing at — an admin fills these in via the
--   new Reference Ranges page once a real conventional-unit reporting
--   need is confirmed for that analyte, rather than this migration
--   guessing and shipping a wrong clinical range.
--
--   conversion_factor is the SI -> Conventional multiplier:
--     conventional_value = si_value * conversion_factor
--   Applied by the client only to DISPLAY/PRINT — the stored result value
--   in results_hematology/results_chemistry/etc. always stays the real SI
--   value entered by the tech; nothing downstream (Delta Check, critical
--   thresholds, auto-verify range checks, eGFR calc) ever reads from this
--   table or needs to change.
--
-- Idempotent — safe to re-run: the table/policies use IF NOT EXISTS /
-- CREATE OR REPLACE, and the seed INSERT uses ON CONFLICT (dept_key,
-- field_code) DO NOTHING so re-running this file never clobbers
-- conventional-unit values an admin has since filled in via the UI. Not
-- applied automatically; for manual review and application in the
-- Supabase SQL editor. Run after migration_v2.44.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.lab_reference_ranges (
  id                  uuid primary key default gen_random_uuid(),
  dept_key            text not null check (dept_key in ('hem','chem','sero','immuno')),
  field_code          text not null,
  label               text not null,
  si_unit             text not null,
  si_lo               numeric,
  si_hi               numeric,
  conventional_unit   text,
  conventional_lo     numeric,
  conventional_hi     numeric,
  conversion_factor   numeric,
  updated_by          uuid,
  updated_by_name     text,
  updated_at          timestamptz not null default now(),
  unique (dept_key, field_code)
);

create index if not exists lab_reference_ranges_dept_idx on public.lab_reference_ranges (dept_key);

comment on table public.lab_reference_ranges is
  'Admin-managed reference range + unit per (dept_key, field_code), one row per RESULT_META entry (index.html). Seeded from RESULT_META''s existing SI values below. conventional_* columns are the optional Conventional/US-unit equivalent, filled in by an admin via the Reference Ranges page (or pre-seeded here for a small set of well-known conversions) — a NULL conventional_unit means the client falls back to displaying the SI value/unit for that field, which is also correct for fields that are already unit-identical between systems (e.g. most enzyme U/L values).';
comment on column public.lab_reference_ranges.conversion_factor is
  'SI -> Conventional multiplier: conventional_value = si_value * conversion_factor. Never applied to the stored result value itself, only to what the client displays/prints when CFG.labUnitSystem is ''conventional''.';

alter table public.lab_reference_ranges enable row level security;

drop policy if exists lab_reference_ranges_select on public.lab_reference_ranges;
create policy lab_reference_ranges_select on public.lab_reference_ranges
  for select using (public.is_admin() or public.is_clinical_staff() or public.is_billing_staff());

-- Write access is admin-only, same as Price List (price_list) — reference
-- ranges are a clinical-governance setting, not something lab_supervisor
-- (or any other role) should be able to change day-to-day.
drop policy if exists lab_reference_ranges_insert on public.lab_reference_ranges;
create policy lab_reference_ranges_insert on public.lab_reference_ranges
  for insert with check (public.is_admin());

drop policy if exists lab_reference_ranges_update on public.lab_reference_ranges;
create policy lab_reference_ranges_update on public.lab_reference_ranges
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists lab_reference_ranges_delete on public.lab_reference_ranges;
create policy lab_reference_ranges_delete on public.lab_reference_ranges
  for delete using (public.is_admin());

revoke all on public.lab_reference_ranges from anon;
grant select, insert, update, delete on public.lab_reference_ranges to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- SEED — SI values copied verbatim from RESULT_META (index.html). Every
-- field RESULT_META defines gets a row; conventional_* filled in only for
-- the well-known conversions described above.
-- ═══════════════════════════════════════════════════════════════════════

insert into public.lab_reference_ranges
  (dept_key, field_code, label, si_unit, si_lo, si_hi, conventional_unit, conventional_lo, conventional_hi, conversion_factor)
values
  -- ── Haematology ──────────────────────────────────────────────────
  ('hem','wbc','WBC','×10³/µL',4.0,10.0,null,null,null,null),
  ('hem','rbc','RBC','×10⁶/µL',3.9,5.9,null,null,null,null),
  ('hem','hgb','HGB — Haemoglobin','g/dL',12.0,17.5,null,null,null,null),
  ('hem','hct','HCT','%',37,52,null,null,null,null),
  ('hem','mcv','MCV','fL',80,100,null,null,null,null),
  ('hem','mch','MCH','pg',27,33,null,null,null,null),
  ('hem','mchc','MCHC','g/dL',31.5,36,null,null,null,null),
  ('hem','rdw','RDW','%',11.5,14.5,null,null,null,null),
  ('hem','nrbc','NRBC','/100 WBC',0,0,null,null,null,null),
  ('hem','plt','PLT — Platelets','×10³/µL',150,400,null,null,null,null),
  ('hem','mpv','MPV','fL',7.5,12.5,null,null,null,null),
  ('hem','pdw','PDW','%',9,17,null,null,null,null),
  ('hem','neut','Neutrophils','%',50,70,null,null,null,null),
  ('hem','lymph','Lymphocytes','%',20,40,null,null,null,null),
  ('hem','mono','Monocytes','%',2,10,null,null,null,null),
  ('hem','eosi','Eosinophils','%',1,6,null,null,null,null),
  ('hem','baso','Basophils','%',0,1,null,null,null,null),
  ('hem','pt','PT','sec',11,14,null,null,null,null),
  ('hem','inr','INR','',0.8,1.2,null,null,null,null),
  ('hem','aptt','aPTT','sec',25,35,null,null,null,null),
  ('hem','tt','Thrombin Time (TT)','sec',10,17,null,null,null,null),
  ('hem','fibg','Fibrinogen','g/L',2.0,4.0,null,null,null,null),
  ('hem','ddimer','D-Dimer','mg/L FEU',0,0.5,null,null,null,null),
  ('hem','esr','ESR','mm/hr',0,20,null,null,null,null),
  -- ── Chemistry ────────────────────────────────────────────────────
  ('chem','tbil','T. Bilirubin','µmol/L',0,17,'mg/dL',0,0.99,0.0585),
  ('chem','dbil','D. Bilirubin','µmol/L',0,5,'mg/dL',0,0.29,0.0585),
  ('chem','ibil','I. Bilirubin','µmol/L',0,12,'mg/dL',0,0.70,0.0585),
  ('chem','alt','ALT (SGPT)','U/L',7,56,null,null,null,null),
  ('chem','ast','AST (SGOT)','U/L',10,40,null,null,null,null),
  ('chem','alp','ALP','U/L',44,147,null,null,null,null),
  ('chem','ggt','GGT','U/L',0,51,null,null,null,null),
  ('chem','tp','Total Protein','g/L',60,83,'g/dL',6.0,8.3,0.1),
  ('chem','alb','Albumin','g/L',35,50,'g/dL',3.5,5.0,0.1),
  ('chem','creat','Creatinine','µmol/L',62,106,'mg/dL',0.70,1.20,0.0113),
  ('chem','urea','Urea','mmol/L',2.5,7.8,'BUN mg/dL',7,22,2.8),
  ('chem','ua','Uric Acid','mmol/L',0.20,0.42,'mg/dL',3.4,7.1,16.85),
  ('chem','egfr','eGFR','mL/min/1.73m²',60,999,null,null,null,null),
  ('chem','na','Sodium (Na)','mmol/L',136,145,'mEq/L',136,145,1),
  ('chem','k','Potassium (K)','mmol/L',3.5,5.1,'mEq/L',3.5,5.1,1),
  ('chem','cl','Chloride','mmol/L',98,107,'mEq/L',98,107,1),
  ('chem','co2','CO₂ / Bicarbonate','mmol/L',22,29,'mEq/L',22,29,1),
  ('chem','ca','Calcium','mmol/L',2.1,2.6,'mg/dL',8.4,10.4,4.0),
  ('chem','phos','Phosphorus','mmol/L',0.8,1.5,'mg/dL',2.5,4.6,3.097),
  ('chem','mg','Magnesium','mmol/L',0.7,1.1,'mg/dL',1.7,2.7,2.431),
  ('chem','fbs','Fasting Blood Sugar','mmol/L',3.9,6.1,'mg/dL',70,110,18.0),
  ('chem','rbs','Random Blood Sugar','mmol/L',3.9,11.1,'mg/dL',70,200,18.0),
  ('chem','ppbs','2hr Post-Prandial','mmol/L',3.9,7.8,'mg/dL',70,140,18.0),
  ('chem','hba1c','HbA1c','%',4,5.7,null,null,null,null),
  ('chem','ins','Insulin','µIU/mL',2.6,25,null,null,null,null),
  ('chem','cpep','C-Peptide','ng/mL',0.5,2.7,null,null,null,null),
  ('chem','tchol','Total Cholesterol','mmol/L',0,5.2,'mg/dL',0,201,38.67),
  ('chem','ldl','LDL Cholesterol','mmol/L',0,3.4,'mg/dL',0,131,38.67),
  -- HDL's si_hi=99 is RESULT_META's existing sentinel for "no real upper
  -- bound" (HDL only has a clinically meaningful LOWER limit) -- left
  -- untouched on the SI side per instruction, but NOT blindly multiplied
  -- through to a nonsensical conventional_hi; conventional_hi is null here
  -- (no upper bound), not a converted sentinel.
  ('chem','hdl','HDL Cholesterol','mmol/L',1.0,99,'mg/dL',39,null,38.67),
  ('chem','trig','Triglycerides','mmol/L',0,1.7,'mg/dL',0,151,88.57),
  ('chem','troponin_i','Troponin I','ng/mL',0,0.04,null,null,null,null),
  ('chem','hs_tnt','hs-TnT','ng/L',0,14,null,null,null,null),
  ('chem','ck','CK Total','U/L',30,200,null,null,null,null),
  ('chem','ckmb','CK-MB','U/L',0,25,null,null,null,null),
  ('chem','nt_probnp','NT-proBNP','pg/mL',0,125,null,null,null,null),
  ('chem','hs_crp','hs-CRP','mg/L',0,5,null,null,null,null),
  ('chem','ldh','LDH','U/L',140,280,null,null,null,null),
  -- ── Serology ─────────────────────────────────────────────────────
  ('sero','rf','RF','IU/mL',0,14,null,null,null,null),
  ('sero','aso','ASO','IU/mL',0,200,null,null,null,null),
  ('sero','ige','IgE (Total)','IU/mL',0,100,null,null,null,null),
  -- ── Immunology (Hormones / Tumour Markers / Vitamins) ───────────
  ('immuno','tsh','TSH','mIU/L',0.4,4.0,null,null,null,null),
  ('immuno','ft4','Free T4','pmol/L',9,25,null,null,null,null),
  ('immuno','ft3','Free T3','pmol/L',3.5,7.8,null,null,null,null),
  ('immuno','t3','Total T3','nmol/L',1.2,2.7,null,null,null,null),
  ('immuno','t4','Total T4','nmol/L',55,161,null,null,null,null),
  ('immuno','fsh','FSH','IU/L',1,12,null,null,null,null),
  ('immuno','lh','LH','IU/L',1,12,null,null,null,null),
  ('immuno','estradiol','Oestradiol','pmol/L',0,999,null,null,null,null),
  ('immuno','prog','Progesterone','nmol/L',0,89,null,null,null,null),
  ('immuno','testosterone','Testosterone','nmol/L',0,31,null,null,null,null),
  ('immuno','prolactin','Prolactin','mIU/L',72,511,null,null,null,null),
  ('immuno','psa','PSA','ng/mL',0,4,null,null,null,null),
  ('immuno','afp','AFP','IU/mL',0,5.8,null,null,null,null),
  ('immuno','cea','CEA','ng/mL',0,5,null,null,null,null),
  ('immuno','ca125','CA-125','U/mL',0,35,null,null,null,null),
  ('immuno','ca199','CA 19-9','U/mL',0,37,null,null,null,null),
  ('immuno','vit_d','Vitamin D','nmol/L',50,250,null,null,null,null),
  ('immuno','vit_b12','Vitamin B12','pmol/L',145,637,null,null,null,null),
  ('immuno','folate','Folate','nmol/L',7,46,null,null,null,null),
  ('immuno','ferritin','Ferritin','µg/L',15,200,null,null,null,null)
on conflict (dept_key, field_code) do nothing;

-- ═══════════════════════════════════════════════════════════════════════
-- END migration_v2.45_lab_reference_ranges.sql
--
-- After applying, sanity-check with (read-only, safe to run):
--   select dept_key, count(*), count(conventional_unit) as has_conventional
--     from public.lab_reference_ranges group by dept_key order by dept_key;
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'lab_reference_ranges' order by cmd;
-- ═══════════════════════════════════════════════════════════════════════
