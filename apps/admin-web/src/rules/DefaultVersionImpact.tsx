import type { Overview } from "../Operations";

export function DefaultVersionImpact({ data, next }: { data: Overview; next: { id: string; version: string } }) {
  const current = data.versions.find(version => version.isDefault);
  const assignments = data.assignments.filter(assignment => data.deployments.some(deployment => deployment.id === assignment.deploymentId));
  const following = assignments.filter(assignment => assignment.mode === "LATEST_APPROVED").length;
  const pinnedToCurrent = current ? assignments.filter(assignment => assignment.mode === "PINNED" && assignment.scoringRuleVersionId === current.id).length : 0;
  const pinnedToNext = assignments.filter(assignment => assignment.mode === "PINNED" && assignment.scoringRuleVersionId === next.id).length;
  return <section aria-label="Default change impact" className="space-y-3 text-sm">
    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3">
      <div><dt className="text-muted-foreground">Current default</dt><dd className="break-words font-medium">{current?.version ?? "Not set"}</dd></div>
      <div><dt className="text-muted-foreground">New default</dt><dd className="break-words font-medium">{next.version}</dd></div>
    </dl>
    <dl className="space-y-2">
      {[
        ["Deployments using the current default version", current ? following + pinnedToCurrent : 0],
        ["Following default, will switch", current?.id === next.id ? 0 : following],
        ["Pinned to current version, will stay", pinnedToCurrent],
        ["Already pinned to the new version", pinnedToNext],
      ].map(([label, count]) => <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="font-semibold tabular-nums">{count}</dd></div>)}
    </dl>
    <p className="text-muted-foreground">All deployments following Default will use {next.version} for new assessments. Pinned deployments and assessments already started keep their rules.</p>
    <p className="text-xs text-muted-foreground">Counts include paused deployments. They use the new default when resumed.</p>
  </section>;
}
