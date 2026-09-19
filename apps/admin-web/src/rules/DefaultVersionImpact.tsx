import type { Overview } from "../Operations";

export function DefaultVersionImpact({ data, next }: { data: Overview; next: { id: string; version: string } }) {
  const current = data.versions.find(version => version.isDefault);
  const assignments = data.assignments.filter(assignment => data.deployments.some(deployment => deployment.id === assignment.deploymentId));
  const following = assignments.filter(assignment => assignment.mode === "LATEST_APPROVED").length;
  const pinnedToCurrent = current ? assignments.filter(assignment => assignment.mode === "PINNED" && assignment.scoringRuleVersionId === current.id).length : 0;
  const pinnedToNext = assignments.filter(assignment => assignment.mode === "PINNED" && assignment.scoringRuleVersionId === next.id).length;
  const switching = current?.id === next.id ? 0 : following;
  const paused = assignments.filter(assignment => assignment.mode === "LATEST_APPROVED" && data.deployments.some(deployment => deployment.id === assignment.deploymentId && !deployment.enabled)).length;
  return <section aria-label="Default change impact" className="space-y-4 text-sm">
    <p className="break-words">{current ? <>Change default from <strong>{current.version}</strong> to <strong>{next.version}</strong>.</> : <>Set <strong>{next.version}</strong> as the default.</>}</p>
    <div className="rounded-lg bg-primary/5 p-4">
      <p className="font-medium">{switching === 0 ? "No deployments will switch versions." : <>{switching} {switching === 1 ? "deployment will" : "deployments will"} use {next.version} for new assessments.</>}</p>
      {switching > 0 && <p className="mt-1 text-muted-foreground">These deployments are set to use Default.</p>}
    </div>
    <p className="text-muted-foreground">Assessments already started keep their original rules.</p>
    <details className="border-t pt-3">
      <summary className="cursor-pointer text-muted-foreground">View deployment details</summary>
      <ul className="mt-3 space-y-2">
        {current && <li>{following + pinnedToCurrent} {following + pinnedToCurrent === 1 ? "deployment currently uses" : "deployments currently use"} {current.version}.</li>}
        {pinnedToCurrent > 0 && <li>{pinnedToCurrent} {pinnedToCurrent === 1 ? "deployment is" : "deployments are"} set to {current?.version} directly and will keep using it.</li>}
        {pinnedToNext > 0 && <li>{pinnedToNext} {pinnedToNext === 1 ? "deployment already uses" : "deployments already use"} {next.version} directly.</li>}
        <li>Deployments set to a specific version will not change.</li>
        {paused > 0 && <li>{paused} {paused === 1 ? "paused deployment is" : "paused deployments are"} included in the switch. They will use {next.version} when resumed.</li>}
      </ul>
    </details>
  </section>;
}
