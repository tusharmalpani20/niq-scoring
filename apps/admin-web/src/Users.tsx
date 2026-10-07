import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./components/ui/alert-dialog";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";
import { paginate } from "./pagination";
import { Plus, UserRoundCheck, UserRoundX } from "lucide-react";
import { Tabs, TabsContent } from "./components/ui/tabs";
import { ListTab, ListTabHeader } from "./ListTabHeader";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "./components/ui/dialog";
import { Card, CardContent } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { invitationSchema } from "./form-validation";
import type { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { request, message, type User } from "./api";
import { Button } from "./components/ui/button";
import { ErrorNotice, FormInput } from "./shared";
type Invitation = {
  id: string;
  email: string;
  displayName: string;
  expiresAt: string;
  createdAt: string;
};

function InvitationEmptyIllustration() {
  return (
    <svg viewBox="0 0 192 136" className="h-28 w-40" aria-hidden="true" focusable="false">
      <circle cx="96" cy="64" r="56" fill="var(--accent)" />
      <ellipse cx="96" cy="125" rx="57" ry="4" fill="var(--border)" opacity="0.5" />
      <circle cx="28" cy="43" r="4" fill="var(--primary)" opacity="0.45" />
      <circle cx="167" cy="85" r="3" fill="var(--primary)" opacity="0.45" />
      <rect x="38" y="44" width="116" height="72" rx="13" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      <path d="m48 56 48 34 48-34M48 104l29-26m67 26-29-26" fill="none" stroke="var(--primary)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
      <circle cx="145" cy="37" r="18" fill="var(--primary)" />
      <path d="M145 29v16m-8-8h16" stroke="var(--primary-foreground)" strokeLinecap="round" strokeWidth="2.5" />
    </svg>
  );
}

export function Users({ currentUser }: { currentUser: User }) {
  const [data, setData] = useState<{
    users: User[];
    invitations: Invitation[];
  } | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const requestSequence = useRef(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [userPage, setUserPage] = useState(1);
  const [invitationPage, setInvitationPage] = useState(1);
  const [activeTab, setActiveTab] = useState("users");
  const [busy, setBusy] = useState(false);
  const [accessTarget, setAccessTarget] = useState<User | null>(null);
  const form = useForm<z.infer<typeof invitationSchema>>({
    resolver: zodResolver(invitationSchema),
    defaultValues: { displayName: "", email: "" },
  });
  const { isDirty } = form.formState;
  const [secret, setSecret] = useState<{
    value: string;
    expiresAt: string;
  } | null>(null);
  async function refresh() {
    const sequence = ++requestSequence.current;
    setLoadingData(true);
    setLoadError("");
    try {
      const next = await request<{ users: User[]; invitations: Invitation[] }>("/admin/users");
      if (sequence === requestSequence.current) {
        setData(next);
        setLoadError("");
      }
    } catch (c) {
      if (sequence === requestSequence.current) {
        setLoadError(message(c));
        throw c;
      }
    } finally {
      if (sequence === requestSequence.current) setLoadingData(false);
    }
  }
  useEffect(() => {
    void refresh().catch(() => {});
    return () => { requestSequence.current += 1; };
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      try { await refresh(); } catch { /* The change succeeded; the refresh error is shown separately. */ }
    } catch (c) {
      setError(message(c));
    } finally {
      setBusy(false);
    }
  }
  async function invite({
    email,
    displayName,
  }: z.infer<typeof invitationSchema>) {
    await action(async () => {
      const result = await request<{
        invitationToken: string;
        expiresAt: string;
      }>("/admin/users/invitations", { email, displayName });
      setCopied(false);
      setSecret({
        value: `${location.origin}/accept-invitation#token=${encodeURIComponent(result.invitationToken)}`,
        expiresAt: result.expiresAt,
      });
      form.reset();
      setInvitationPage(1);
      setActiveTab("invitations");
    });
  }
  const users = paginate(data?.users ?? [], userPage);
  const invitations = paginate(data?.invitations ?? [], invitationPage);
  const current = activeTab === "users" ? users : invitations;
  const setPage = activeTab === "users" ? setUserPage : setInvitationPage;
  return (
    <>
      {!inviteOpen && <ErrorNotice error={error} />}
      {!inviteOpen && <ErrorNotice error={loadError} />}
      {!inviteOpen && data && loadError && <Button variant="outline" disabled={loadingData} onClick={() => void refresh().catch(() => {})}>Try again</Button>}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-5">
        <ListTabHeader label="User management" tabs={<>
          <ListTab value="users" count={data ? users.total : undefined}>Users</ListTab>
          <ListTab value="invitations" count={data ? invitations.total : undefined}>Pending invitations</ListTab>
        </>} actions={
          <Dialog open={inviteOpen} onOpenChange={(open) => {
            if (busy) return;
            if (!open && (secret ? !copied : isDirty)) { setConfirmClose(true); return; }
            setInviteOpen(open);
            if (!open) { form.reset(); setSecret(null); setCopied(false); setConfirmClose(false); setError(""); }
          }}>
            <DialogTrigger asChild>
              <Button size="icon" aria-label="Invite user" title="Invite user">
                <Plus aria-hidden="true" />
              </Button>
            </DialogTrigger>
            <DialogContent aria-describedby={secret ? "invitation-description" : undefined} className="min-w-0 max-h-[90dvh] overflow-y-auto [&>*]:min-w-0">
              <DialogHeader>
                <DialogTitle>{secret ? "Invitation created" : "Invite user"}</DialogTitle>
                {secret && <DialogDescription id="invitation-description">Share the invite link with your teammate to help them get started.</DialogDescription>}
              </DialogHeader>
              <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{secret ? "Close without copying the link?" : "Discard invitation?"}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {secret ? "You haven’t copied the invite link yet. You won’t be able to retrieve it after closing. The invitation will remain active until it expires or you revoke it." : "You have unsaved details. If you leave now, they’ll be discarded and no invitation will be created."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{secret ? "Keep it open" : "Keep editing"}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => {
                      setConfirmClose(false);
                      setInviteOpen(false);
                      setSecret(null);
                      setCopied(false);
                      setError("");
                      form.reset();
                    }}>{secret ? "Close anyway" : "Discard"}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <ErrorNotice error={error} />
              {secret ? (
                <div className="space-y-2">
                  <Button variant="link" className="h-auto justify-start p-0 text-sm underline underline-offset-4" onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(secret.value);
                      setCopied(true);
                      setError("");
                    } catch {
                      setError("We couldn’t copy the link. Please try again.");
                    }
                  }}>
                    {copied ? "Link copied · Copy again" : "Copy invite link"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Link expires on {new Date(secret.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} at {new Date(secret.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.
                  </p>
                  <span className="sr-only" role="status">{copied ? "Invitation link copied to clipboard." : ""}</span>
                </div>
              ) : (
          <form
            noValidate
            onSubmit={form.handleSubmit(invite)}
            className="form-stack"
          >
            <FormInput
              control={form.control}
              name="displayName"
              label="Full name"
              required
              maxLength={120}
            />
            <FormInput
              control={form.control}
              name="email"
              label="Email address"
              type="email"
              required
            />
            <DialogFooter className="grid grid-cols-2 gap-2 sm:flex [&_button]:px-2 [&_button]:text-sm">
              <DialogClose asChild><Button type="button" variant="outline" disabled={busy}>Cancel</Button></DialogClose>
              <Button disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
            </DialogFooter>
            <p className="muted">
              Invitations are not sent by email automatically.
            </p>
          </form>
              )}
            </DialogContent>
          </Dialog>
        } />
        <TabsContent value="users">
          <Card className={users.total > 0 ? "mobile-list-card" : undefined}><CardContent className="pt-6">
          {!data ? (
            loadError ? <Button variant="outline" disabled={loadingData} onClick={() => void refresh().catch(() => {})}>Try again</Button> : <p role="status">Loading users…</p>
          ) : (
            <div>
              <Table className="mobile-record-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Administrator</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Access</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.rows.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell data-label="Administrator">
                        <span className="min-w-0 text-left">
                          <strong className="text-primary">{u.displayName}{u.id === currentUser.id ? " (you)" : ""}</strong>
                          <small>{u.email}</small>
                        </span>
                      </TableCell>
                      <TableCell data-label="Status">
                        <Badge variant={u.enabled ? "success" : "inactive"}>
                          {u.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </TableCell>
                      <TableCell data-label="Access">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${u.enabled ? "Disable" : "Enable"} ${u.displayName}`}
                          title={`${u.enabled ? "Disable" : "Enable"} ${u.displayName}`}
                          disabled={busy || u.id === currentUser.id}
                          onClick={() => setAccessTarget(u)}
                        >
                          {u.enabled ? <UserRoundX aria-hidden="true" /> : <UserRoundCheck aria-hidden="true" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="invitations">
          <Card className={invitations.total > 0 ? "mobile-list-card" : undefined}><CardContent className="pt-6">
            <Table className={invitations.total > 0 ? "mobile-record-table" : undefined}>
              <TableHeader>
                <TableRow>
                  <TableHead>Invitee</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data && invitations.rows.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell data-label="Invitee">
                      <span className="min-w-0 text-left"><strong className="text-primary">{i.displayName}</strong><small>{i.email}</small></span>
                    </TableCell>
                    <TableCell data-label="Expires">{new Date(i.expiresAt).toLocaleString()}</TableCell>
                    <TableCell data-label="Action">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          action(async () => {
                            await request(
                              `/admin/users/invitations/${i.id}`,
                              undefined,
                              "DELETE",
                            );
                          })
                        }
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!data ? (
              loadError ? <Button variant="outline" disabled={loadingData} onClick={() => void refresh().catch(() => {})}>Try again</Button> : <p role="status" className="py-8 text-center">Loading invitations…</p>
            ) : invitations.total === 0 && (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 py-8 text-center">
                <InvitationEmptyIllustration />
                <div className="space-y-1">
                  <h2 className="font-semibold">No pending invitations</h2>
                  <p className="text-sm text-muted-foreground">Create an invitation for a teammate to join the scoring workspace.</p>
                </div>
                <Button className="mt-2" onClick={() => setInviteOpen(true)}>
                  <Plus aria-hidden="true" /> Invite teammates
                </Button>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>
        {data && (activeTab !== "invitations" || invitations.total > 0) && (
          <Pagination aria-label={`${activeTab === "users" ? "Users" : "Pending invitations"} pagination`} className="mt-4">
            <PaginationContent>
              <PaginationItem>
                <Button variant="outline" size="sm" disabled={current.page === 1} onClick={() => setPage(current.page - 1)}>Previous</Button>
              </PaginationItem>
              <PaginationItem>
                <span className="whitespace-nowrap px-2 text-xs text-muted-foreground sm:px-3 sm:text-sm" role="status">Page {current.page} of {current.pageCount}</span>
              </PaginationItem>
              <PaginationItem>
                <Button variant="outline" size="sm" disabled={current.page === current.pageCount} onClick={() => setPage(current.page + 1)}>Next</Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </Tabs>
      <AlertDialog open={accessTarget !== null} onOpenChange={open => { if (!open) setAccessTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{accessTarget?.enabled ? "Disable" : "Enable"} {accessTarget?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {accessTarget?.enabled
                ? "This will remove their access to the scoring workspace until you enable them again."
                : "This will restore their access to the scoring workspace."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant={accessTarget?.enabled ? "destructive" : "default"} onClick={() => {
              const target = accessTarget;
              if (!target) return;
              setAccessTarget(null);
              void action(async () => {
                await request(`/admin/users/${target.id}/enabled`, { enabled: !target.enabled }, "PATCH");
              });
            }}>{accessTarget?.enabled ? "Disable access" : "Enable access"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
