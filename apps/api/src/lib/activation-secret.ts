import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

// Credentials remain hash-only. A short exchange replay derives the same secret from
// the caller's token and request ID; key rotation invalidates uncompleted exchanges.
export function activationExchangeCredential(token: string, requestId: string, key: string): string {
  const derive = (part: string) => createHmac("sha256", Buffer.from(key, "hex")).update(JSON.stringify(["niq-activation-v1", part, token, requestId])).digest("base64url");
  return `niq_dep_${derive("prefix").slice(0, 12)}.${derive("secret")}`;
}
export function encryptActivationToken(token: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString("base64url")).join(".");
}
export function decryptActivationToken(value: string, key: string): string {
  const [iv, tag, ciphertext] = value.split(".").map(part => Buffer.from(part, "base64url"));
  if (!iv || !tag || !ciphertext) throw new Error("Invalid activation token ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
