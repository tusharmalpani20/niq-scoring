export type User = {
  id: string;
  email: string;
  displayName: string;
  enabled: boolean;
  createdAt: string;
};
export async function request<T = unknown>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined && method === "POST" ? "GET" : method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path.startsWith("/admin/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(friendlyError(result.error, response.status));
  }
  return result as T;
}
export function message(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "Something went wrong. Please try again.";
}

const errors: Record<string, string> = {
  INVALID_CREDENTIALS:
    "The email or password is incorrect, or your account is disabled.",
  INVALID_REQUEST: "Please check the entered details and try again.",
  INVALID_ORIGIN:
    "This console address is not authorized. Contact your deployment operator.",
  UNAUTHORIZED: "Your session has expired. Please sign in again.",
  RATE_LIMITED: "Too many attempts. Please wait a few minutes and try again.",
  SETUP_COMPLETE:
    "An administrator already exists. Refresh this page to sign in.",
  INVALID_SETUP_TOKEN:
    "The setup token is invalid. Check it with your deployment operator.",
  SETUP_UNAVAILABLE:
    "Administrator setup is not configured. Contact your deployment operator.",
  INVITATION_INVALID_OR_EXPIRED:
    "This invitation has expired, was revoked, or has already been used. Ask an administrator for a new invitation.",
  EMAIL_EXISTS: "An administrator already uses this email address.",
  EMAIL_ALREADY_EXISTS: "An administrator already uses this email address.",
  USER_EXISTS: "An administrator already uses this email address.",
  ADMIN_LOCKOUT_PREVENTED:
    "You cannot disable yourself or the last enabled administrator.",
  CANNOT_DISABLE_SELF: "You cannot disable your own account.",
  LAST_ADMIN: "At least one administrator must remain enabled.",
  NOT_FOUND: "This record is no longer available. Refresh and try again.",
  INTERNAL_ERROR:
    "The service could not complete the request. Please try again.",
};
function friendlyError(code: unknown, status: number) {
  return typeof code === "string" && errors[code]
    ? errors[code]
    : status >= 500
      ? "The scoring service is unavailable. Please try again shortly."
      : "The request could not be completed. Check the details and try again.";
}
