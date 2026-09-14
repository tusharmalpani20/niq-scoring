import type { Overview } from "./Operations";
import { ActivationTokenPanel } from "./ActivationTokenPanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Badge } from "./components/ui/badge";

export function DeploymentDetailsDialog({ data, deployment, clientName, hostingLabel, initialTab = "details", onClose }: {
  data: Overview; deployment: Overview["deployments"][number]; clientName: string; hostingLabel: string; initialTab?: "details" | "tokens"; onClose: () => void;
}) {
  const assignment = data.assignments.find(item => item.deploymentId === deployment.id);
  const version = assignment?.mode === "PINNED" ? data.versions.find(item => item.id === assignment.scoringRuleVersionId)?.version ?? "Not specified" : assignment ? "Latest approved" : "Not specified";
  const allowance = (capability: string) => {
    const entitlement = data.entitlements.find(item => item.deploymentId === deployment.id && item.capability === capability);
    return !entitlement?.enabled ? "Disabled" : entitlement.monthlyLimit === null ? "Unlimited" : `${entitlement.monthlyLimit.toLocaleString()} per month`;
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent aria-describedby={undefined} className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{clientName}</DialogTitle></DialogHeader>
      <Tabs defaultValue={initialTab} className="gap-5">
        <TabsList variant="line" aria-label="Deployment information" className="h-11 w-full justify-start gap-6 rounded-none border-b p-0">
          <TabsTrigger className="h-full flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary" value="details">Details</TabsTrigger><TabsTrigger className="h-full flex-none rounded-none border-0 bg-transparent px-1 shadow-none data-[state=active]:bg-transparent data-[state=active]:text-primary after:bottom-0 after:bg-primary" value="tokens">Tokens</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <dl className="grid gap-5 sm:grid-cols-2">
            <div><dt className="text-sm text-muted-foreground">Client</dt><dd className="mt-1">{clientName}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Hosting</dt><dd className="mt-1">{hostingLabel}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Environment</dt><dd className="mt-1 capitalize">{deployment.environment}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Status</dt><dd className="mt-1"><Badge variant={deployment.enabled ? "default" : "secondary"}>{deployment.enabled ? "Enabled" : "Disabled"}</Badge></dd></div>
            <div><dt className="text-sm text-muted-foreground">Scoring</dt><dd className="mt-1">{allowance("SCORING")}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Face scan</dt><dd className="mt-1">{allowance("FACE_SCAN")}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Rule version</dt><dd className="mt-1">{version}</dd></div>
          </dl>
        </TabsContent>
        <TabsContent value="tokens"><ActivationTokenPanel deploymentId={deployment.id} disabled={false} /></TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>;
}
