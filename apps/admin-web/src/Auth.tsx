import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { authSchema } from "./form-validation";
import type { z } from "zod";
import { useEffect, useState } from "react";
import { request, message, type User } from "./api";
import { Button } from "./components/ui/button";
import { Separator } from "./components/ui/separator";
import { Panel, FormInput, ErrorNotice } from "./shared";
export function Auth({
  setupRequired,
  invitationToken,
  onLogin,
  onSetup,
  onInvitationAccepted,
}: {
  setupRequired: boolean;
  invitationToken: string;
  onLogin: (user: User) => void;
  onSetup: () => void;
  onInvitationAccepted: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [notice, setNotice] = useState("");
  const invite = !!invitationToken && !accepted;
  const creating = setupRequired || invite;
  const mode = invite ? "invite" : setupRequired ? "setup" : "login";
  const schema = authSchema(mode);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      displayName: "",
      setupToken: "",
      password: "",
      confirm: "",
    },
  });
  const { reset, getValues } = form;
  useEffect(() => {
    // Never carry secrets between login, setup, or invitation flows.
    reset({ ...getValues(), setupToken: "", password: "", confirm: "" });
    setError("");
  }, [mode, invitationToken, reset, getValues]);
  async function submit({
    email,
    password,
    displayName,
    setupToken,
  }: z.infer<typeof schema>) {
    setError("");
    setBusy(true);
    try {
      if (invite) {
        await request("/auth/accept-invitation", { invitationToken, password });
        setAccepted(true);
        onInvitationAccepted();
        setNotice(
          "Your account is ready. Sign in with your email and password.",
        );
        form.reset({
          ...form.getValues(),
          setupToken: "",
          password: "",
          confirm: "",
        });
      } else if (setupRequired) {
        await request("/auth/setup", {
          setupToken,
          displayName,
          email,
          password,
        });
        onSetup();
        setNotice("Your administrator account is ready. Sign in to continue.");
        form.reset({
          ...form.getValues(),
          setupToken: "",
          password: "",
          confirm: "",
        });
      } else {
        const result = await request<{ user: User }>("/auth/login", {
          email,
          password,
        });
        onLogin(result.user);
      }
    } catch (c) {
      setError(message(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <div className="auth-intro">
        <div className="brandmark">
          NIQ<span>Scoring</span>
        </div>
        <div>
          <h1>
            One platform.
            <br />
            Every scoring decision.
          </h1>
          <p>
            Manage access, client deployments and scoring rules from one
            secure console.
          </p>
        </div>
        <small>For authorized NIQ administrators.</small>
      </div>
      <div className="auth-content">
        <Panel
          title={
            invite
              ? "Accept your invitation"
              : setupRequired
                ? "Create the first administrator"
                : "Welcome back"
          }
          description={
            invite
              ? "Choose a password to activate your NIQ administrator account."
              : setupRequired
                ? "Set up the initial NIQ administrator. This step is available only before the first account is created."
                : "Sign in to the NIQ scoring console."
          }
        >
          <form
            noValidate
            onSubmit={form.handleSubmit(submit)}
            className="form-stack"
          >
            {setupRequired && (
              <>
                <FormInput
                  control={form.control}
                  name="setupToken"
                  label="Setup token"
                  description="Use the setup token configured by your deployment operator."
                  type="password"
                  autoComplete="off"
                  required
                />
                <Separator />
                <FormInput
                  control={form.control}
                  name="displayName"
                  label="Full name"
                  autoComplete="name"
                  required
                  maxLength={120}
                />
              </>
            )}
            {!invite && (
              <FormInput
                control={form.control}
                name="email"
                label="Email address"
                type="email"
                autoComplete="username"
                required
              />
            )}
            <FormInput
              control={form.control}
              name="password"
              label="Password"
              type="password"
              autoComplete={creating ? "new-password" : "current-password"}
              required
              minLength={creating ? 12 : undefined}
              maxLength={128}
            />
            {creating && (
              <>
                <FormInput
                  control={form.control}
                  name="confirm"
                  label="Confirm password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </>
            )}
            <ErrorNotice error={error} />
            {notice && (
              <p className="success" role="status">
                {notice}
              </p>
            )}
            <Button disabled={busy} type="submit">
              {busy
                ? "Please wait…"
                : invite
                  ? "Create my account"
                  : setupRequired
                    ? "Create administrator"
                    : "Sign in"}
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
