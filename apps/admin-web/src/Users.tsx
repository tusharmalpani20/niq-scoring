import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { invitationSchema } from "./form-validation";
import type { z } from "zod";
import { useEffect, useState } from "react";
import { request, message, type User } from "./api";
import { Button } from "./components/ui/button";
import { ErrorNotice, FormInput, Panel, Secret } from "./shared";
type Invitation = {
  id: string;
  email: string;
  displayName: string;
  expiresAt: string;
  createdAt: string;
};
export function Users({ currentUser }: { currentUser: User }) {
  const [data, setData] = useState<{
    users: User[];
    invitations: Invitation[];
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useForm<z.infer<typeof invitationSchema>>({
    resolver: zodResolver(invitationSchema),
    defaultValues: { displayName: "", email: "" },
  });
  const [secret, setSecret] = useState<{
    value: string;
    expiresAt: string;
  } | null>(null);
  async function refresh() {
    setData(await request("/admin/users"));
  }
  useEffect(() => {
    refresh().catch((c) => setError(message(c)));
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
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
      setSecret({
        value: `${location.origin}/accept-invitation#token=${encodeURIComponent(result.invitationToken)}`,
        expiresAt: result.expiresAt,
      });
      form.reset();
    });
  }
  return (
    <>
      <ErrorNotice error={error} />
      <div className="page-grid">
        <Panel
          title="NIQ administrators"
          description="Every enabled user has administrator access to this console."
        >
          {!data ? (
            <p>Loading users…</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Administrator</th>
                    <th>Status</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <strong>
                          {u.displayName}
                          {u.id === currentUser.id ? " (you)" : ""}
                        </strong>
                        <small>{u.email}</small>
                      </td>
                      <td>
                        <span className={u.enabled ? "pill" : "pill muted"}>
                          {u.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </td>
                      <td>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || u.id === currentUser.id}
                          onClick={() =>
                            action(async () => {
                              await request(
                                `/admin/users/${u.id}/enabled`,
                                { enabled: !u.enabled },
                                "PATCH",
                              );
                            })
                          }
                        >
                          {u.enabled ? "Disable" : "Enable"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel
          title="Invite administrator"
          description="Create a one-time invitation link. Share it directly with your NIQ colleague."
        >
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
            <Button disabled={busy}>
              {busy ? "Please wait…" : "Create invitation"}
            </Button>
            <p className="muted">
              Invitations are not sent by email automatically.
            </p>
          </form>
        </Panel>
      </div>
      {secret && (
        <Secret
          label="One-time invitation link"
          {...secret}
          onDismiss={() => setSecret(null)}
        />
      )}
      <Panel
        title="Pending invitations"
        description="Revoke an invitation to prevent it from being accepted."
      >
        {!data ? (
          <p>Loading invitations…</p>
        ) : data.invitations.length === 0 ? (
          <p className="empty">No pending invitations.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invitee</th>
                  <th>Expires</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.invitations.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.displayName}</strong>
                      <small>{i.email}</small>
                    </td>
                    <td>{new Date(i.expiresAt).toLocaleString()}</td>
                    <td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
