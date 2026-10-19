import type { ReportEvidence } from "./report-content";

type Source = { id: string; text: string };
const joined = (items: string[]) => items.length < 2 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** Conservative synthesis for fallback runs: each phrase is backed by a
 * recorded fact or matched action, not copied from a broad rule strategy. */
export function closingReportSummary(input: {
  riskLabel: string;
  evidence: ReportEvidence[];
  nutrition: Source[];
  monitoring: Source[];
  products: Source[];
}) {
  const { evidence, nutrition, monitoring, products } = input;
  const ids = new Set<string>(["fact:niq_risk"]);
  const add = (rows: Source[]) => rows.forEach(row => row.id.split(" ").forEach(id => ids.add(id)));
  const factLabel = (row: Source) => row.text.replace(/^Assessment records [^:]+:\s*/, "")
    .replace(/\. This does not establish a treatment cause\.$/, "").replace(/\.$/, "");
  const concerns: string[] = [];
  const symptoms = evidence.filter(row => /^fact:assessment_(?:dietary|gastrointestinal)_symptoms_/.test(row.id))
    .filter(row => !/^(?:none|no symptoms?|not applicable)$/i.test(factLabel(row)));
  const activity = evidence.find(row => /^fact:assessment_functional_capacity_/.test(row.id) && /reduced|limited|bed|chair/i.test(factLabel(row)));
  const appetite = evidence.find(row => /^fact:assessment_appetite_status_/.test(row.id));
  if (activity) { concerns.push(factLabel(activity).toLocaleLowerCase()); add([activity]); }
  const weightLoss = evidence.find(row => row.id === "fact:weight_direction" && /^Recorded weight loss:/.test(row.text));
  if (weightLoss) { concerns.push("recorded weight loss"); add([weightLoss]); }
  for (const row of symptoms) {
    const label = factLabel(row);
    const concern = /mouth sores?|mouth ulcers?|mucositis/i.test(label) ? "mouth ulcers" : label.toLocaleLowerCase();
    if (!concerns.includes(concern)) concerns.push(concern);
    add([row]);
  }
  const sentences = [`Your assessment indicates ${input.riskLabel.toLocaleLowerCase()}.`];
  if (concerns.length) {
    const normalAppetite = appetite && /^normal$/i.test(factLabel(appetite));
    if (normalAppetite) add([appetite]);
    sentences.push(`${normalAppetite ? "Although your appetite is normal, " : "Recorded concerns include "}${joined(concerns)}${normalAppetite ? (concerns.length === 1 ? `${concerns[0] === "mouth ulcers" ? " remain" : " remains"} a priority for nutrition care` : " remain priorities for nutrition care") : ""}.`);
  } else if (appetite && !/^normal|none$/i.test(factLabel(appetite))) {
    add([appetite]); sentences.push(`Your reported ${factLabel(appetite).toLocaleLowerCase()}${/appetite/i.test(factLabel(appetite)) ? "" : " appetite"} is an important consideration in planning your intake.`);
  }
  const priorities: string[] = [];
  const prioritySources: Source[] = [];
  const addPriority = (pattern: RegExp, phrase: string) => {
    const rows = nutrition.filter(row => pattern.test(row.text));
    if (rows.length) { priorities.push(phrase); prioritySources.push(...rows); }
  };
  addPriority(/energy|protein|nutrition(?:al)? requirements|nutrition needs/i, "meeting your nutritional needs");
  addPriority(/muscle|strength|functional/i, "supporting muscle strength and function");
  addPriority(/symptom|mouth|mucositis|soft.{0,10}moist/i, "adapting food choices to symptoms");
  add(prioritySources);
  if (priorities.length) sentences.push(`The plan focuses on ${joined(priorities)}${products.length ? `, with ${joined([...new Set(products.map(row => row.text))])} as the selected nutrition support` : ""}.`);
  else if (products.length) sentences.push(`The prescribed plan includes ${joined([...new Set(products.map(row => row.text))])} as nutrition support.`);
  if (products.length) add(products);
  const followUp: string[] = [];
  for (const [pattern, phrase] of [
    [/weight/i, "weight trends"], [/intake|food/i, "food intake"], [/symptom/i, "symptoms"],
    [/blood pressure|\bBP\b/i, "blood pressure"], [/thyroid|\bTSH\b/i, "thyroid monitoring"],
    [/complete blood count|\bCBC\b/i, "blood counts"],
  ] as Array<[RegExp, string]>) {
    const rows = monitoring.filter(row => pattern.test(row.text));
    if (rows.length) { followUp.push(phrase); add(rows); }
  }
  if (followUp.length) sentences.push(`Follow-up should review ${joined(followUp)}.`);
  return { text: sentences.join(" "), evidenceIds: [...ids] };
}
