import type { ApptType, ExistingPolicy, ProspectProfile, QuizAnswer } from "./types";

const pick = <T,>(arr: readonly T[], rand: () => number) => arr[Math.floor(rand() * arr.length)];
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const TYPES: { type: ApptType; weight: number }[] = [
  { type: "New money", weight: 0.34 },
  { type: "Policy review", weight: 0.2 },
  { type: "401(k) rollover", weight: 0.16 },
  { type: "Annuity review", weight: 0.12 },
  { type: "Retirement income plan", weight: 0.12 },
  { type: "Beneficiary & estate review", weight: 0.06 },
];

const SPOUSES = ["Linda", "Karen", "Susan", "Mary", "Deborah", "James", "Robert", "Michael", "David", "William"];
const NEW_MONEY_SOURCES = [
  "401(k) from a former employer",
  "Maturing CDs",
  "Brokerage account they want to de-risk",
  "Proceeds from a home sale",
  "Inheritance",
  "Pension lump-sum offer",
  "Business sale",
];
const TIMING = ["Available now", "Within 30 days", "In 60–90 days", "Early next year"];
const POLICY_TYPES = [
  { product: "Fixed indexed annuity", valueRange: [80_000, 450_000], note: "Surrender period ends" },
  { product: "Variable annuity", valueRange: [120_000, 600_000], note: "Fees around 3% a year; review riders" },
  { product: "Whole life insurance", valueRange: [100_000, 500_000], note: "Face amount; check cash value and loans" },
  { product: "Term life insurance", valueRange: [250_000, 1_000_000], note: "Term ends" },
  { product: "Long-term care policy", valueRange: [150, 400], note: "Daily benefit; premium increase notice received" },
  { product: "Multi-year guaranteed annuity (MYGA)", valueRange: [50_000, 300_000], note: "Rate guarantee ends" },
];
const GOALS = [
  "Protect savings from a market downturn",
  "Create guaranteed lifetime income",
  "Reduce taxes on retirement withdrawals",
  "Leave a legacy for children and grandchildren",
  "Plan for long-term care costs",
  "Retire within the next few years with confidence",
  "Consolidate accounts into one plan",
  "Maximize Social Security timing",
];

/**
 * A believable, fictional background for a sample prospect: appointment type, household, money in
 * motion and existing products, shaped by their quiz answers. Used for demos until live CRM data exists.
 */
export function sampleProfile(rand: () => number, answers: QuizAnswer[], assets: number | null, year = new Date().getUTCFullYear()): ProspectProfile {
  const ans = (re: RegExp) => answers.find((a) => re.test(a.question.toLowerCase()))?.answer ?? "";
  const retire = ans(/retire\?|planning to retire/);
  const concern = ans(/concern/);
  const hasAdvisor = /yes/i.test(ans(/advisor/));
  let x = rand();
  let apptType: ApptType = TYPES[0].type;
  for (const t of TYPES) {
    x -= t.weight;
    if (x <= 0) {
      apptType = t.type;
      break;
    }
  }
  const existingClient = apptType === "Policy review" || apptType === "Annuity review" || (apptType === "Beneficiary & estate review" && rand() < 0.5);
  const married = rand() < 0.68;
  // Spouse age sits near the prospect's own age band.
  const ageBand = ans(/old|age/).match(/\d+/g)?.map(Number) ?? [60];
  const ownAge = ageBand.length > 1 ? (ageBand[0] + ageBand[1]) / 2 : ageBand[0] + 2;
  const retired = /already retired/i.test(retire);
  const base = assets ?? 250_000;

  const policies: ExistingPolicy[] = [];
  const nPolicies = existingClient ? 1 + Math.floor(rand() * 2) : rand() < 0.45 ? 1 : 0;
  for (let i = 0; i < nPolicies; i++) {
    const p = pick(POLICY_TYPES, rand);
    const issued = 2008 + Math.floor(rand() * 15);
    const v = p.valueRange[0] + rand() * (p.valueRange[1] - p.valueRange[0]);
    const isLtc = p.product.startsWith("Long-term care");
    const ends = issued + 7 + Math.floor(rand() * 4);
    // A surrender period or guarantee that has already ended is an opportunity: the money can move without penalty.
    const note = !p.note.endsWith("ends")
      ? p.note
      : ends < year
        ? `${p.note.replace(/ ends$/, "")} ended ${ends}, so it can be moved without penalty`
        : `${p.note} ${ends}`;
    policies.push({
      product: p.product,
      issued: String(issued),
      value: isLtc ? `${money(v)}/day benefit` : money(Math.round(v / 1000) * 1000),
      note,
    });
  }

  const newMoney =
    apptType === "New money" || apptType === "401(k) rollover" || (apptType === "Retirement income plan" && rand() < 0.6)
      ? {
          amount: Math.round((base * (0.35 + rand() * 0.5)) / 5_000) * 5_000,
          source: apptType === "401(k) rollover" ? "401(k) from a former employer" : pick(NEW_MONEY_SOURCES, rand),
          timing: pick(TIMING, rand),
        }
      : undefined;

  const goals = new Set<string>();
  if (/running out/i.test(concern)) goals.add("Create guaranteed lifetime income");
  if (/volatility/i.test(concern)) goals.add("Protect savings from a market downturn");
  if (/tax/i.test(concern)) goals.add("Reduce taxes on retirement withdrawals");
  if (/health|care/i.test(concern)) goals.add("Plan for long-term care costs");
  if (/legacy/i.test(concern)) goals.add("Leave a legacy for children and grandchildren");
  while (goals.size < 3) goals.add(pick(GOALS, rand));

  const notes: string[] = [];
  notes.push(existingClient ? "Existing client. Annual review is due." : "New prospect from the quiz. First meeting.");
  if (policies.some((x) => /without penalty/.test(x.note ?? ""))) notes.push("At least one policy is out of its surrender period, so there's room to reposition it.");
  if (hasAdvisor) notes.push("Currently works with another advisor, so ask what they would change about that relationship.");
  if (newMoney) notes.push(`${money(newMoney.amount)} in motion from ${newMoney.source.toLowerCase()} (${newMoney.timing.toLowerCase()}).`);
  if (policies.some((p) => /Variable annuity/.test(p.product))) notes.push("Variable annuity fees are likely a pain point; prepare a fee comparison.");
  if (policies.some((p) => /Long-term care/.test(p.product))) notes.push("Received a premium increase notice on the long-term care policy.");
  if (married && rand() < 0.5) notes.push("Spouse should attend; decisions are made together.");

  const prep = [
    "Confirm the appointment by text the day before",
    existingClient ? "Pull current policy statements and the last review notes" : "Ask them to bring recent account and policy statements",
    ...(newMoney ? [`Prepare income and protection illustrations for ${money(newMoney.amount)}`] : []),
    ...(policies.length ? ["Check surrender schedules, riders and beneficiary designations on existing policies"] : []),
    "Run a Social Security timing estimate",
  ];

  return {
    apptType,
    existingClient,
    meetingFormat: pick(["In person · Mandeville office", "In person · Mandeville office", "Zoom video call", "Phone call"], rand),
    maritalStatus: married ? "Married" : pick(["Widowed", "Single", "Divorced"], rand),
    spouse: married ? `${pick(SPOUSES, rand)}, ${Math.round(ownAge - 4 + rand() * 8)}` : undefined,
    employment: retired ? "Retired" : `Working · plans to retire ${retire ? retire.toLowerCase() : "soon"}`,
    householdIncome: retired ? pick(["$55k–$80k (Social Security + pension)", "$80k–$120k (Social Security + pension)", "$40k–$60k (Social Security)"], rand) : pick(["$90k–$130k", "$130k–$200k", "$200k+"], rand),
    riskTolerance: /volatility|running out/i.test(concern) ? "Conservative" : pick(["Conservative", "Moderately conservative", "Moderate"], rand),
    newMoney,
    existingPolicies: policies,
    goals: [...goals].slice(0, 4),
    notes,
    prep,
  };
}
