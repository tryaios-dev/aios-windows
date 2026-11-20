import { clipboard } from "electron";
import { z } from "zod";
import { Id, LinkedResource } from "@aios/bridge-contract";
import type { Handler } from "./index.js";

const resource = (id: unknown) => `/resources/${encodeURIComponent(Id.parse(id))}`;
const limit = z.number().min(0).max(100_000).nullable();
// Printable, no spaces: what an API key (bearer token) can hold. Same rule as the backend.
const apiKey = z.string().regex(/^[\x21-\x7e]{16,512}$/);

/**
 * Add resources to my AI. The API key never reaches the window (invariant 3): the person copies
 * it, main reads it from the clipboard here, sends it to the backend (which checks it with the
 * provider and keeps it only in the OS key store) and then empties the clipboard. It is never
 * logged or returned.
 */
export const resourcesHandlers: Record<string, Handler> = {
  "resources.list": async (b) => z.array(LinkedResource).parse(await b.client.request("GET", "/resources")),
  // A key an operator stored on this computer wins (the person only presses Link); otherwise the
  // key the person copied. The clipboard is emptied only when its key was sent.
  "resources.link": async (b, id, monthlyLimit) => {
    const key = apiKey.safeParse(clipboard.readText().trim());
    const linked = LinkedResource.parse(
      await b.client.request("POST", `${resource(id)}/link`, {
        api_key: key.success ? key.data : null,
        monthly_limit: limit.parse(monthlyLimit),
      }),
    );
    if (key.success) clipboard.clear();
    return linked;
  },
  "resources.unlink": async (b, id) => {
    await b.client.request("DELETE", resource(id));
  },
};
