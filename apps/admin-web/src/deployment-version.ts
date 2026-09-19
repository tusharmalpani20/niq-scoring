import type { Overview } from "./Operations";

export function defaultVersionLabel(data: Overview) {
  const version = data.versions.find(version => version.isDefault);
  return version ? `Default (${version.version})` : "Default (not set)";
}

export function deploymentVersion(data: Overview, deploymentId: string) {
  const assignment = data.assignments.find(item => item.deploymentId === deploymentId);
  if (!assignment) return { id: null, followsDefault: false, label: "Not assigned" };
  const followsDefault = assignment.mode === "LATEST_APPROVED";
  const version = data.versions.find(item => followsDefault ? item.isDefault : item.id === assignment.scoringRuleVersionId);
  return {
    id: version?.id ?? null,
    followsDefault,
    label: followsDefault ? defaultVersionLabel(data) : version?.version ?? "Version unavailable",
  };
}
