import type { RuleDefinition } from "@niq-scoring/contracts/rules";
export function issueLocation(definition: RuleDefinition, rawPath: unknown) {
  const path = Array.isArray(rawPath) ? rawPath.join(".") : String(rawPath ?? "");
  const parts = path.split(".");
  const group = parts[0] ?? "";
  const tab = group === "sections" || group === "calculations" ? "questionnaire" : ["domains", "scoring", "total", "classifications"].includes(group) ? "scoring" : group === "interventions" ? "interventions" : group === "samples" ? "validation" : "details";
  const pick = <T extends { id: string }>(items: T[], part: string | undefined) => part === undefined ? undefined : /^\d+$/.test(part) ? items[Number(part)] : items.find(item => item.id === part);
  if (group === "sections") {
    const section = pick(definition.sections, parts[1]);
    const question = section && parts[2] === "questions" ? pick(section.questions, parts[3]) : undefined;
    if (question) return { tab, label: question.label, id: `rule-question-${question.id}` };
    if (section) return { tab, label: section.title, id: `rule-section-${section.id}` };
  }
  for (const key of ["calculations", "domains", "scoring", "classifications", "interventions", "samples", "issues"] as const) {
    if (group !== key) continue;
    const item = pick<{ id: string }>(definition[key], parts[1]);
    if (item) {
      const label = "label" in item ? String(item.label) : "name" in item ? String(item.name) : key === "issues" ? "Source decision" : key;
      return { tab, label, id: `rule-${key}-${item.id}` };
    }
  }
  return { tab, label: tab === "validation" ? "Sample cases" : tab.charAt(0).toUpperCase() + tab.slice(1), id: `rule-tab-${tab}` };
}
