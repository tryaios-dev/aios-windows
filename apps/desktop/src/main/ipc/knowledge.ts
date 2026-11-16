import { BrowserWindow, dialog } from "electron";
import type { OpenDialogOptions } from "electron";
import { z } from "zod";
import { FolderPreview, Id, KnowledgeCollection, KnowledgeDoc, KnowledgePaths } from "@aios/bridge-contract";
import type { Handler } from "./index.js";

const doc = (id: unknown) => `/knowledge/${encodeURIComponent(Id.parse(id))}`;

async function open(options: OpenDialogOptions): Promise<string[] | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled || !result.filePaths.length ? null : result.filePaths;
}

/** My secure knowledge. Files are only read by the backend; nothing here opens their content. */
export const knowledgeHandlers: Record<string, Handler> = {
  "knowledge.list": async (b) => z.array(KnowledgeDoc).parse(await b.client.request("GET", "/knowledge")),
  "knowledge.chooseFiles": async () =>
    open({
      title: "Add files to your secure knowledge",
      properties: ["openFile", "multiSelections"],
      filters: [
        // Every kind is shown: AIOS reads what it can and says why for the rest (an old .doc, a picture, a zip).
        {
          name: "Documents",
          extensions: ["pdf", "docx", "doc", "rtf", "xlsx", "xls", "csv", "pptx", "ppt", "txt", "md", "html", "htm"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    }),
  "knowledge.chooseFolder": async () =>
    (await open({ title: "Choose a folder for your secure knowledge", properties: ["openDirectory"] }))?.[0] ?? null,
  "knowledge.addFiles": async (b, paths, collection) =>
    z.array(KnowledgeDoc).parse(
      await b.client.request("POST", "/knowledge", {
        paths: KnowledgePaths.parse(paths),
        collection: KnowledgeCollection.parse(collection),
      }),
    ),
  "knowledge.previewFolder": async (b, folder) =>
    FolderPreview.parse(
      await b.client.request("POST", "/knowledge/folder/preview", { path: z.string().min(1).max(1024).parse(folder) }),
    ),
  "knowledge.addFolder": async (b, folder) =>
    z
      .array(KnowledgeDoc)
      .parse(await b.client.request("POST", "/knowledge/folder", { path: z.string().min(1).max(1024).parse(folder) })),
  "knowledge.retry": async (b, id) => KnowledgeDoc.parse(await b.client.request("POST", `${doc(id)}/retry`)),
  "knowledge.remove": async (b, id) => {
    await b.client.request("DELETE", doc(id));
  },
};
