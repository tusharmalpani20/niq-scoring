import { z } from "zod";

const email = z.string().trim().email("Enter a valid email address.").max(254);
const displayName = z.string().trim().min(1, "Enter your full name.").max(120);
export const invitationSchema = z.object({ email, displayName });
export function authSchema(mode: "setup" | "invite" | "login") {
  const creating = mode !== "login";
  return z
    .object({
      email: mode === "invite" ? z.string() : email,
      displayName: mode === "setup" ? displayName : z.string(),
      setupToken:
        mode === "setup"
          ? z.string().min(1, "Enter the setup token.")
          : z.string(),
      password: z
        .string()
        .min(
          creating ? 8 : 1,
          creating ? "Use at least 8 characters." : "Enter your password.",
        )
        .max(128, "Use at most 128 characters."),
      confirm: z.string(),
    })
    .refine((v) => !creating || v.password === v.confirm, {
      path: ["confirm"],
      message: "Passwords do not match.",
    });
}
const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export function dataFormSchema(fields: string[], title: string) {
  const shape: Record<string, z.ZodType<string, string>> = Object.fromEntries(
    fields.map((name): [string, z.ZodType<string, string>] => {
      let schema = z.string().trim();
      if (name === "monthlyLimit")
        return [
          name,
          schema.refine(
            (v) =>
              v === "" || (/^\d+$/.test(v) && Number.isSafeInteger(Number(v))),
            "Enter a non-negative whole number, or leave empty for unlimited usage.",
          ),
        ];
      if (name.endsWith("Id"))
        return [name, schema.regex(ulid, "Enter a valid ID.")];
      if (name === "environment")
        return [
          name,
          z.enum(["development", "test", "staging", "production"], {
            error: "Use development, test, staging, or production.",
          }),
        ];
      if (name === "capability")
        return [
          name,
          z.enum(["SCORING", "FACE_SCAN"], {
            error: "Use SCORING or FACE_SCAN.",
          }),
        ];
      const max =
        name === "externalReference"
          ? 100
          : name === "region"
            ? 50
            : name === "name" && title === "Create deployment"
              ? 120
              : 200;
      return [
        name,
        schema
          .min(2, "Enter at least 2 characters.")
          .max(max, `Use at most ${max} characters.`),
      ];
    }),
  );
  return z.object(shape);
}
