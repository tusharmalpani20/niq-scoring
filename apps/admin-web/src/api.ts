export type User = {
  id: string;
  email: string;
  displayName: string;
  enabled: boolean;
  createdAt: string;
};
export class ApiError extends Error {
  constructor(message: string, public code: string, public issues: unknown[] = []) { super(message); }
}
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
    throw new ApiError(friendlyError(result.error, response.status), result.error, result.issues ?? []);
  }
  return result as T;
}
export function message(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "Something went wrong. Please try again.";
}

const errors: Record<string, string> = {
  FIXED_RULE_REQUIRED: "Fields and options must match the fixed Excel questionnaire. Create a new version for older custom definitions.",
  VERSION_UNAVAILABLE: "Choose an approved, available rule version.",
  RULE_REVISION_CONFLICT: "This version changed in another session. Your edits are preserved. Reload only when you are ready to discard them.",
  RULE_NAME_EXISTS: "A rule version with this name already exists.",
  RULE_IMMUTABLE: "This version is read-only. Duplicate it to make changes.",
  RULE_IN_USE: "This version is referenced and cannot be deleted.",
  RULE_NOT_FOUND: "This version is no longer available.",
  RULE_REQUEST_CONFLICT: "This creation request changed. Close the form and start a new creation attempt.",
  RULE_REQUEST_DELETED: "The draft from this creation attempt was deleted. Start a new creation attempt.",
  RULE_VALIDATION_FAILED: "Resolve the validation issues before continuing.",
  INVALID_RULE_DEFINITION: "The definition contains invalid fields or references. Review the listed issues.",
  INVALID_RULE_TRANSITION: "This lifecycle action is not available for the current version.",
  PROVISIONAL_THRESHOLDS_UNCONFIRMED: "Temporary risk thresholds are not confirmed. This profile remains blocked from approval, activation, and clinical use.",
  INVALID_ASSESSMENT_ANSWERS: "The assessment answers are invalid. Review the highlighted inputs and try again.",
  LEGACY_RULE_FORMAT: "This version uses the earlier definition format and is read-only.",
  INVALID_CREDENTIALS:
    "The email or password is incorrect, or your account is disabled.",
  DEPLOYMENT_IDENTITY_IMMUTABLE: "Environment and hosting cannot change after creation.",
  TOKEN_STORAGE_UNAVAILABLE: "Activation token storage is not configured. Contact your deployment operator.",
  INVALID_TOKEN_EXPIRY: "Choose a future expiry date.",
  TOKEN_UNAVAILABLE: "This token is no longer available. Refresh the list and try again.",
  RECORD_IN_USE: "This record has been used or still has deployments. Disable it instead.",
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
  CLIENT_NAME_EXISTS: "A client with this name already exists.",
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
