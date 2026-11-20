import { z } from "zod";
import { Id, MediaContent, MediaCreate, MediaItem, MediaSaved, MediaStatus } from "@aios/bridge-contract";
import { pickSaveTarget } from "./dialogs.js";
import type { Handler } from "./index.js";

const item = (id: unknown) => `/media/${encodeURIComponent(Id.parse(id))}`;
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/**
 * Pictures and videos made on the company's GPU server (R-7). The backend sends every request
 * through the provider router and the gateway; nothing here talks to a server.
 */
export const mediaHandlers: Record<string, Handler> = {
  "media.status": async (b) => MediaStatus.parse(await b.client.request("GET", "/media/status")),
  "media.list": async (b, projectId) =>
    z
      .array(MediaItem)
      .parse(await b.client.request("GET", `/projects/${encodeURIComponent(Id.parse(projectId))}/media`)),
  "media.create": async (b, projectId, input) =>
    MediaItem.parse(
      await b.client.request(
        "POST",
        `/projects/${encodeURIComponent(Id.parse(projectId))}/media`,
        MediaCreate.parse(input),
      ),
    ),
  "media.get": async (b, id) => MediaItem.parse(await b.client.request("GET", item(id))),
  "media.content": async (b, id) => MediaContent.parse(await b.client.request("GET", `${item(id)}/content`)),
  "media.cancel": async (b, id) => MediaItem.parse(await b.client.request("POST", `${item(id)}/cancel`)),
  "media.save": async (b, id) => {
    const found = MediaItem.parse(await b.client.request("GET", item(id)));
    const extension = EXTENSIONS[found.mime ?? ""];
    if (found.status !== "done" || !extension) throw new Error("media_not_ready");
    const name = `aios-${found.kind === "video" ? "video" : "picture"}-${found.id.slice(0, 8)}.${extension}`;
    const target = await pickSaveTarget(found.kind === "video" ? "Save the video" : "Save the picture", name, extension);
    if (!target) return null;
    return MediaSaved.parse(await b.client.request("POST", `${item(id)}/save`, { path: target }));
  },
  "media.remove": async (b, id) => {
    await b.client.request("DELETE", item(id));
  },
};
