import type { Overview } from "../Operations";

export function DefaultVersionImpact({ data, next }: { data: Overview; next: { id: string; version: string } }) {
  const current = data.versions.find(version => version.isDefault);
  const assignments = data.assignments.filter(assignment => data.deployments.some(deployment => deployment.id === assignment.deploymentId));
  const following = assignments.filter(assignment => assignment.mode === "LATEST_APPROVED").length;
  const switching = current?.id === next.id ? 0 : following;
  return <section aria-label="Default change impact" className="space-y-4 text-sm">
    <p className="break-words">{current ? <>Change default from <strong>{current.version}</strong> to <strong>{next.version}</strong>.</> : <>Set <strong>{next.version}</strong> as the default.</>}</p>
    <div className="rounded-lg bg-primary/5 p-4">
      <p className="font-medium">{switching === 0 ? "No deployments will switch versions." : <>{switching} {switching === 1 ? "deployment will" : "deployments will"} use {next.version} for new assessments.</>}</p>
      {switching > 0 && <p className="mt-1 text-muted-foreground">These deployments are set to use Default.</p>}
    </div>
    <p className="text-muted-foreground">Assessments already started keep their original rules.</p>
  </section>;
}
