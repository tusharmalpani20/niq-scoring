import type { Overview } from "./Operations";
import { ActivationTokenPanel } from "./ActivationTokenPanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Card, CardContent } from "./components/ui/card";
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
        <TabsContent value="details" className="space-y-4">
          <Card className="shadow-none"><CardContent className="p-0">
            <dl className="divide-y">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-4 px-4 py-3"><dt className="text-sm text-muted-foreground">Client</dt><dd className="break-words text-right font-medium">{clientName}</dd></div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-4 px-4 py-3"><dt className="text-sm text-muted-foreground">Status</dt><dd className="text-right"><Badge variant={deployment.enabled ? "default" : "secondary"}>{deployment.enabled ? "Enabled" : "Disabled"}</Badge></dd></div>
              {[["Hosting", hostingLabel], ["Environment", deployment.environment], ["Rule version", version]].map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-4 px-4 py-3"><dt className="text-sm text-muted-foreground">{label}</dt><dd className={label === "Environment" ? "break-words text-right capitalize" : "break-words text-right"}>{value}</dd></div>)}
            </dl>
          </CardContent></Card>
          <div className="grid gap-3 sm:grid-cols-2">
            {[["Scoring", "SCORING"], ["Face scan", "FACE_SCAN"]].map(([label, capability]) => <Card key={capability} className="shadow-none"><CardContent className="space-y-2 p-4">
              <h3 className="text-sm text-muted-foreground">{label}</h3>
              <p className="font-medium">{allowance(capability!)}</p>
            </CardContent></Card>)}
          </div>
        </TabsContent>
        <TabsContent value="tokens"><ActivationTokenPanel deploymentId={deployment.id} disabled={false} /></TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>;
}
