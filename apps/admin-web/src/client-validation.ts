import { z } from "zod";

export const clientSchema = (clients: ReadonlyArray<{ name: string }>) => z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(200, "Use at most 200 characters.")
    .refine(name => !clients.some(client => client.name.trim().toLowerCase() === name.toLowerCase()), "A client with this name already exists."),
});
