import { Health } from "@aios/bridge-contract";
import type { Handler } from "./index.js";

export const systemHandlers: Record<string, Handler> = {
  "system.health": async (b) => Health.parse(await b.client.request("GET", "/health")),
};
