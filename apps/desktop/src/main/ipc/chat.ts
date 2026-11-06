import { z } from "zod";
import {
  Conversation,
  ConversationPatch,
  EvidenceEvent,
  EvidenceStatus,
  Exchange,
  Id,
  Message,
  Provider,
  ProvidersStatus,
  SearchHit,
} from "@aios/bridge-contract";
import type { Handler } from "./index.js";

const conv = (id: unknown) => `/conversations/${Id.parse(id)}`;

/** Conversations and messages. Message text passes through main and is never logged. */
export const chatHandlers: Record<string, Handler> = {
  "conversations.list": async (b, projectId) =>
    z.array(Conversation).parse(await b.client.request("GET", `/projects/${Id.parse(projectId)}/conversations`)),
  "conversations.create": async (b, projectId, title) =>
    Conversation.parse(
      await b.client.request("POST", `/projects/${Id.parse(projectId)}/conversations`, {
        title: z.string().max(500).optional().parse(title) ?? null,
      }),
    ),
  "conversations.update": async (b, id, patch) =>
    Conversation.parse(await b.client.request("PATCH", conv(id), ConversationPatch.parse(patch))),
  "conversations.remove": async (b, id) => {
    await b.client.request("DELETE", conv(id));
  },
  "conversations.setProvider": async (b, id, to, confirmed) =>
    Conversation.parse(
      await b.client.request("POST", `${conv(id)}/provider`, {
        to: Provider.parse(to),
        confirmed: z.boolean().parse(confirmed),
      }),
    ),
  "conversations.messages": async (b, id) =>
    z.array(Message).parse(await b.client.request("GET", `${conv(id)}/messages`)),
  "conversations.send": async (b, id, text) =>
    Exchange.parse(
      await b.client.request("POST", `${conv(id)}/messages`, { text: z.string().min(1).max(200_000).parse(text) }),
    ),
  "conversations.regenerate": async (b, id) => Exchange.parse(await b.client.request("POST", `${conv(id)}/regenerate`)),
  "conversations.providers": async (b) => ProvidersStatus.parse(await b.client.request("GET", "/providers/status")),
};

export const searchHandlers: Record<string, Handler> = {
  "search.query": async (b, q) => {
    const query = encodeURIComponent(z.string().max(200).parse(q));
    return z.array(SearchHit).parse(await b.client.request("GET", `/search?q=${query}`));
  },
};

export const evidenceHandlers: Record<string, Handler> = {
  "evidence.list": async (b, projectId) => {
    const query = projectId === undefined ? "" : `?project_id=${Id.parse(projectId)}`;
    return z.array(EvidenceEvent).parse(await b.client.request("GET", `/evidence${query}`));
  },
  "evidence.status": async (b) => EvidenceStatus.parse(await b.client.request("GET", "/evidence/status")),
  "evidence.export": async (b) => {
    await b.client.request("POST", "/evidence/export");
  },
};
