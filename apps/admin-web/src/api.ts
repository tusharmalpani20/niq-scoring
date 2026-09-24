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
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined && method === "POST" ? "GET" : method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...extraHeaders },
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
  VERSION_UNAVAILABLE: "Choose an approved, available rule.",
  RULE_REVISION_CONFLICT: "This version changed in another session. Your edits are preserved. Reload only when you are ready to discard them.",
  RULE_NAME_EXISTS: "A rule with this name already exists.",
  RULE_DEFAULT_REQUIRES_ACTIVE: "Activate this version before making it the default.",
  RULE_IS_DEFAULT: "Choose another default before retiring this version.",
  RULE_IMMUTABLE: "This version is read-only. Duplicate it to make changes.",
  RULE_IN_USE: "This version is in use and cannot be deleted.",
  RULE_NOT_FOUND: "This version is no longer available.",
  RULE_REQUEST_CONFLICT: "Close this form and try creating the draft again.",
  RULE_REQUEST_DELETED: "This draft was deleted. Close this form and create a new draft.",
  RULE_VALIDATION_FAILED: "Some rules need attention. Review the issues below.",
  INVALID_RULE_DEFINITION: "Some scoring settings are invalid. Review the issues below.",
  INVALID_RULE_TRANSITION: "This action is not available at the current stage.",
  PROVISIONAL_THRESHOLDS_UNCONFIRMED: "Temporary risk thresholds are not confirmed. This profile remains blocked from approval, activation, and clinical use.",
  INVALID_ASSESSMENT_ANSWERS: "The assessment answers are invalid. Review the highlighted inputs and try again.",
  LEGACY_RULE_FORMAT: "This version uses the earlier definition format and is read-only.",
  INVALID_CREDENTIALS:
    "The email or password is incorrect, or your account is disabled.",
  DEPLOYMENT_IDENTITY_IMMUTABLE: "Environment and hosting cannot change after creation.",
  TOKEN_STORAGE_UNAVAILABLE: "Activation token storage is not configured. Contact your deployment operator.",
  INVALID_TOKEN_EXPIRY: "Choose a future expiry date.",
  TOKEN_UNAVAILABLE: "This token is no longer available. Refresh the list and try again.",
  CREDENTIAL_ALREADY_REVOKED: "This credential was already revoked. Refresh the token list to see its latest status.",
  CREDENTIAL_UNAVAILABLE: "No credential is linked to this token. Refresh the token list and try again.",
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
  DEPLOYMENT_NAME_EXISTS: "This client already has a deployment with that label. Choose another label.",
  CREATE_REQUEST_CONFLICT: "This create request was already used for different settings. Close the form and start a new deployment.",
  CREATE_REQUEST_DELETED: "This deployment was created and later deleted. Close the form and start a new deployment.",
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
