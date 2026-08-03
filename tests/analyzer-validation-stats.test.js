// Prompt2 Phase 5: proves calculateEP15()/calculateEP09()/chi2Upper95()
// are correct against reference datasets with expected outputs computed
// BY HAND (shown in full below), independent of the implementation --
// not derived by reading the code back, and not "looks plausible."
//
// ═══════════════════════════════════════════════════════════════════
// EP15 reference dataset #1 (balanced, 3 runs x 3 replicates) -- hand
// derivation:
//   Run1=[10,12,11] mean=11   Run2=[9,11,10] mean=10   Run3=[11,13,12] mean=12
//   Grand mean = (33+30+36)/9 = 99/9 = 11
//   SS_within = [(10-11)^2+(12-11)^2+(11-11)^2] *3 runs, each run's SS=2
//             = 2+2+2 = 6;  df_within=9-3=6;  MS_within=6/6=1
//   SS_between = 3*(11-11)^2 + 3*(10-11)^2 + 3*(12-11)^2 = 0+3+3=6
//             df_between=2;  MS_between=6/2=3
//   avgR=9/3=3; varBetweenComponent=max(0,(3-1)/3)=0.66667
//   varTotal=1+0.66667=1.66667; sdWithin=1; sdTotal=sqrt(1.66667)=1.290994
//   cvWithinPct=1/11*100=9.09091%; cvTotalPct=1.290994/11*100=11.73631%
// ═══════════════════════════════════════════════════════════════════
const EP15_DATASET_1 = [[10, 12, 11], [9, 11, 10], [11, 13, 12]];
const EP15_1_EXPECTED = {
  grandMean: 11, msWithin: 1, msBetween: 3, dfWithin: 6, dfBetween: 2, totalN: 9, runCount: 3,
  sdWithin: 1, sdTotal: 1.290994, cvWithinPct: 9.09091, cvTotalPct: 11.73631,
};

// ═══════════════════════════════════════════════════════════════════
// EP09 reference dataset #1: Y = 2X + 1 EXACTLY (no noise) -- the
// simplest possible sanity check. Hand derivation:
//   X=[1,2,3,4,5] Y=[3,5,7,9,11]; xMean=3, yMean=7
//   Sxx=4+1+0+1+4=10; Syy=16+4+0+4+16=40
//   Sxy=(-2*-4)+(-1*-2)+(0*0)+(1*2)+(2*4)=8+2+0+2+8=20
//   slope=20/10=2; intercept=7-2*3=1; r2=(20^2)/(10*40)=400/400=1.0
// ═══════════════════════════════════════════════════════════════════
const EP09_DATASET_1_X = [1, 2, 3, 4, 5];
const EP09_DATASET_1_Y = [3, 5, 7, 9, 11];

// ═══════════════════════════════════════════════════════════════════
// EP09 reference dataset #2: realistic noisy data. Hand derivation:
//   X=[10,20,30,40] Y=[12,19,31,38]; xMean=25, yMean=25
//   Sxx=225+25+25+225=500; Syy=169+36+36+169=410
//   Sxy=(-15*-13)+(-5*-6)+(5*6)+(15*13)=195+30+30+195=450
//   slope=450/500=0.9; intercept=25-0.9*25=2.5; r2=450^2/(500*410)=202500/205000=0.987805
//   diffs(Y-X)=[2,-1,1,-2]; meanDiff=0; sdDiffs=sqrt((4+1+1+4)/3)=sqrt(10/3)=1.825742
// ═══════════════════════════════════════════════════════════════════
const EP09_DATASET_2_X = [10, 20, 30, 40];
const EP09_DATASET_2_Y = [12, 19, 31, 38];

// Standard tabulated chi-square 0.95 upper critical values (widely
// published statistical reference table), used to validate the
// Wilson-Hilferty approximation's actual measured error, not just
// assert it's "close enough."
const CHI2_TABULATED_95 = { 1: 3.841, 2: 5.991, 3: 7.815, 4: 9.488, 5: 11.070, 6: 12.592, 9: 16.919, 10: 18.307 };

const { CHAINABLE_MOCK_SRC } = require('./helpers/chainable-mock');
const { makeSuite } = require('./helpers/test-kit');

function initScript() {
  return `
    localStorage.setItem('sb_url','https://mock.supabase.co');
    localStorage.setItem('sb_key','mock-anon-key');
    ${CHAINABLE_MOCK_SRC}
    window.supabase = { createClient: () => ({
      auth: { signInWithPassword: async()=>({data:{user:{id:'u1'}},error:null}), getSession: async()=>({data:{session:null}}), signOut: async()=>({error:null}) },
      from: (table) => { if (table === 'staff') return chainable({ id: 's1', user_id: 'u1', full_name: 'Lab Tech Test', role: 'lab_tech' }, []); return chainable(null, []); },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: async()=>({data:{ok:true},error:null}) },
    }) };
  `;
}

async function login(page, baseUrl) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-screen', { state: 'visible' });
  await page.fill('#auth-email', 'labtech@example.com');
  await page.fill('#auth-pass', 'whatever');
  await page.click('#auth-btn');
  await page.waitForTimeout(300);
}

const close = (a, b, tol) => Math.abs(a - b) <= tol;

module.exports = async function run(context, baseUrl) {
  const t = makeSuite('analyzer-validation-stats');
  const page = await context.newPage();
  await page.addInitScript(initScript());
  await login(page, baseUrl);

  // ── chi2Upper95() vs. tabulated critical values ──────────────────
  // Finding: Wilson-Hilferty's accuracy degrades at very small df (its
  // own well-documented limitation) -- measured here, not assumed.
  // df=1 alone needs a looser tolerance (3%); df>=2 all measure under 1%
  // error and are held to the tighter 2% bound.
  const chi2Results = await page.evaluate((dfs) => dfs.map(df => ({ df, approx: chi2Upper95(df) })), Object.keys(CHI2_TABULATED_95).map(Number));
  for (const { df, approx } of chi2Results) {
    const tabulated = CHI2_TABULATED_95[df];
    const relErrPct = Math.abs(approx - tabulated) / tabulated * 100;
    const tolerance = df === 1 ? 3 : 2;
    t.check(`chi2Upper95(df=${df}) = ${approx.toFixed(4)} vs tabulated ${tabulated} (rel. error ${relErrPct.toFixed(3)}%, within ${tolerance}% tolerance${df===1?' -- widened: Wilson-Hilferty is measurably less accurate at df=1, a degenerate case validation studies should never reach in practice (this app already warns below totalN~20)':''})`, relErrPct < tolerance);
  }

  // ── calculateEP15() — reference dataset #1 (exact/hand-verified) ──
  const ep15_1 = await page.evaluate((data) => calculateEP15(data, 15, 20), EP15_DATASET_1);
  t.check(`EP15 grandMean = ${ep15_1.grandMean} (expected exactly 11)`, ep15_1.grandMean === 11);
  t.check(`EP15 msWithin = ${ep15_1.msWithin} (expected exactly 1)`, ep15_1.msWithin === 1);
  t.check(`EP15 msBetween = ${ep15_1.msBetween} (expected exactly 3)`, ep15_1.msBetween === 3);
  t.check(`EP15 dfWithin=${ep15_1.dfWithin}, dfBetween=${ep15_1.dfBetween}, totalN=${ep15_1.totalN}, runCount=${ep15_1.runCount} (expected 6,2,9,3)`,
    ep15_1.dfWithin === 6 && ep15_1.dfBetween === 2 && ep15_1.totalN === 9 && ep15_1.runCount === 3);
  t.check(`EP15 sdWithin = ${ep15_1.sdWithin} (expected exactly 1)`, ep15_1.sdWithin === 1);
  t.check(`EP15 sdTotal = ${ep15_1.sdTotal.toFixed(6)} (expected 1.290994, tol 1e-4)`, close(ep15_1.sdTotal, 1.290994, 1e-4));
  t.check(`EP15 cvWithinPct = ${ep15_1.cvWithinPct.toFixed(5)} (expected 9.09091%, tol 1e-3)`, close(ep15_1.cvWithinPct, 9.09091, 1e-3));
  t.check(`EP15 cvTotalPct = ${ep15_1.cvTotalPct.toFixed(5)} (expected 11.73631%, tol 1e-3)`, close(ep15_1.cvTotalPct, 11.73631, 1e-3));
  t.check('EP15 passClaimedCV/passTEa/overallPass are all true (sdWithin=1 well under UVL; cvTotal=11.7% well under TEa=20%)',
    ep15_1.passClaimedCV === true && ep15_1.passTEa === true && ep15_1.overallPass === true);

  // ── calculateEP15() — a claimed CV tight enough to FAIL ──────────
  const ep15_fail = await page.evaluate((data) => calculateEP15(data, 2, 5), EP15_DATASET_1);
  t.check('EP15 with an unrealistically tight claimed CV (2%) and TEa (5%) correctly FAILS both criteria', ep15_fail.passClaimedCV === false && ep15_fail.passTEa === false && ep15_fail.overallPass === false);

  // ── calculateEP15() edge cases ────────────────────────────────────
  const ep15_singleRun = await page.evaluate(() => calculateEP15([[1, 2, 3]], 10, 10));
  t.check('EP15 with only 1 run returns an error (one-way ANOVA needs >=2 runs)', !!ep15_singleRun.error);

  const ep15_zeroVariance = await page.evaluate(() => calculateEP15([[5, 5, 5], [5, 5, 5]], 10, 10));
  t.check('EP15 with zero within-run variance (all identical values) returns an error, not NaN/Infinity', !!ep15_zeroVariance.error);

  const ep15_unbalanced = await page.evaluate(() => calculateEP15([[10, 12], [9, 11, 10, 12]], 20, 20));
  t.check('EP15 handles an unbalanced design (different replicate counts per run) without crashing', !ep15_unbalanced.error && ep15_unbalanced.totalN === 6 && ep15_unbalanced.runCount === 2);

  const ep15_missingCells = await page.evaluate(() => calculateEP15([[10, null, 12], [9, 11, undefined]], 20, 20));
  t.check('EP15 silently drops null/undefined cells rather than poisoning the sums with NaN', !ep15_missingCells.error && !isNaN(ep15_missingCells.grandMean) && ep15_missingCells.totalN === 4);

  const ep15_lowN = await page.evaluate(() => calculateEP15([[10, 11], [9, 10]], 20, 20));
  t.check('EP15 warns when total N is below the practical stability minimum (~20)', ep15_lowN.warnings.some(w => /20/.test(w)));

  // ── calculateEP09() — reference dataset #1 (exact, Y=2X+1) ────────
  const ep09_1 = await page.evaluate(({ x, y }) => calculateEP09(x, y), { x: EP09_DATASET_1_X, y: EP09_DATASET_1_Y });
  t.check(`EP09 dataset 1: regressionMethod is explicitly labeled 'OLS' (never 'Deming')`, ep09_1.regressionMethod === 'OLS');
  t.check(`EP09 dataset 1: slope = ${ep09_1.slope} (expected exactly 2)`, ep09_1.slope === 2);
  t.check(`EP09 dataset 1: intercept = ${ep09_1.intercept} (expected exactly 1)`, ep09_1.intercept === 1);
  t.check(`EP09 dataset 1: r2 = ${ep09_1.r2} (expected exactly 1.0, perfect linear fit)`, ep09_1.r2 === 1);
  t.check(`EP09 dataset 1: biasPct = ${ep09_1.biasPct.toFixed(4)} (expected 133.3333%, tol 1e-3)`, close(ep09_1.biasPct, 133.3333, 1e-3));
  t.check(`EP09 dataset 1: sdDiffs = ${ep09_1.sdDiffs.toFixed(6)} (expected 1.581139, tol 1e-4)`, close(ep09_1.sdDiffs, 1.581139, 1e-4));

  // ── calculateEP09() — reference dataset #2 (realistic noise) ─────
  const ep09_2 = await page.evaluate(({ x, y }) => calculateEP09(x, y), { x: EP09_DATASET_2_X, y: EP09_DATASET_2_Y });
  t.check(`EP09 dataset 2: slope = ${ep09_2.slope} (expected exactly 0.9)`, close(ep09_2.slope, 0.9, 1e-9));
  t.check(`EP09 dataset 2: intercept = ${ep09_2.intercept} (expected exactly 2.5)`, close(ep09_2.intercept, 2.5, 1e-9));
  t.check(`EP09 dataset 2: r2 = ${ep09_2.r2.toFixed(6)} (expected 0.987805, tol 1e-5)`, close(ep09_2.r2, 0.987805, 1e-5));
  t.check(`EP09 dataset 2: meanDiff = ${ep09_2.meanDiff} (expected exactly 0)`, ep09_2.meanDiff === 0);
  t.check(`EP09 dataset 2: sdDiffs = ${ep09_2.sdDiffs.toFixed(6)} (expected 1.825742, tol 1e-4)`, close(ep09_2.sdDiffs, 1.825742, 1e-4));

  // ── calculateEP09() edge cases ─────────────────────────────────────
  const ep09_tooFew = await page.evaluate(() => calculateEP09([1], [2]));
  t.check('EP09 with only 1 pair returns an error (need >=2 for a regression line)', !!ep09_tooFew.error);

  const ep09_zeroVarX = await page.evaluate(() => calculateEP09([5, 5, 5], [1, 2, 3]));
  t.check('EP09 with zero variance in X returns an error, not a division-by-zero NaN slope', !!ep09_zeroVarX.error);

  const ep09_mismatched = await page.evaluate(() => calculateEP09([1, 2, 3, 4], [10, 20, 30]));
  t.check('EP09 with mismatched X/Y array lengths warns and uses only the index-aligned overlap (3 pairs)', ep09_mismatched.n === 3 && ep09_mismatched.warnings.length > 0);

  const ep09_missingValues = await page.evaluate(() => calculateEP09([1, 2, null, 4, 5], [1, 2, 3, undefined, 5]));
  t.check('EP09 drops pairs with a missing value on either side (2 of 5 dropped, 3 valid pairs remain) and warns', ep09_missingValues.n === 3 && ep09_missingValues.warnings.length > 0);

  const ep09_lowN = await page.evaluate(() => calculateEP09([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]));
  t.check('EP09 warns when sample count is below CLSI\'s commonly-cited 40-sample minimum', ep09_lowN.warnings.some(w => /40/.test(w)));

  await page.close();
  return t;
};
