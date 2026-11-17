import { z } from "zod";
import {
  Conversation,
  ConversationPatch,
  ConversationSummary,
  EvidenceCheckpoint,
  EvidenceEvent,
  EvidenceExport,
  EvidenceExportInput,
  EvidenceStatus,
  EvidenceStream,
  Exchange,
  GenerationState,
  Id,
  KnowledgeIds,
  Message,
  Provider,
  ProvidersStatus,
  SearchHit,
} from "@aios/bridge-contract";
import { pickSaveTarget } from "./dialogs.js";
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
  "conversations.send": async (b, id, text, knowledgeIds) =>
    Exchange.parse(
      await b.client.request("POST", `${conv(id)}/messages`, {
        text: z.string().min(1).max(200_000).parse(text),
        knowledge_ids: KnowledgeIds.parse(knowledgeIds) ?? [],
      }),
    ),
  "conversations.regenerate": async (b, id) => Exchange.parse(await b.client.request("POST", `${conv(id)}/regenerate`)),
  "conversations.generation": async (b, id) =>
    GenerationState.parse(await b.client.request("GET", `${conv(id)}/generation`)),
  "conversations.stop": async (b, id) => Message.parse(await b.client.request("POST", `${conv(id)}/stop`)),
  "conversations.summary": async (b, id) =>
    ConversationSummary.nullable().parse(await b.client.request("GET", `${conv(id)}/summary`)),
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
  "evidence.stream": async (b) => EvidenceStream.parse(await b.client.request("GET", "/evidence/stream")),
  "evidence.checkpoints": async (b) =>
    z.array(EvidenceCheckpoint).parse(await b.client.request("GET", "/evidence/checkpoints")),
  /** The user picks where; the writer builds and signs the bundle (F-07); the backend writes it. */
  "evidence.export": async (b, input) => {
    const what = EvidenceExportInput.parse(input);
    const day = new Date().toISOString().slice(0, 10);
    const target = await pickSaveTarget("Export evidence", `aios-evidence-${day}.zip`, "zip");
    if (!target) return null;
    return EvidenceExport.parse(
      await b.client.request("POST", "/evidence/export", { ...what, path: target, confirmed: true }),
    );
  },
};
