/**
 * Endpoint façade: the seam between screens and the backend. One function per MVP 9.3
 * local API endpoint. The renderer never holds a port or a token (SR-08).
 *
 * Desktop app: every call goes to the backend through `window.aios`, and `./live.ts` loads the
 * backend's answers into the store the screens read. Plain browser (`pnpm dev:ui`): the
 * simulated store in `./sim` answers, so the screens can be worked on without Electron.
 *
 * Not in this build, so simulated in the browser and refused in the desktop app: download from
 * the model mirror, the local engine (answers, stop, benchmark) and the evidence writer (export).
 */
import { errorCode, type BackupFolder, type PickedFile } from "@aios/bridge-contract";
import { bridge } from "./index";
import {
  applySettings,
  change,
  isLive,
  loadMessages,
  messageFor,
  refreshConversation,
  refreshConversations,
  refreshEvents,
  refreshHealth,
  refreshModels,
  refreshProjects,
  refreshSettings,
  refreshStatus,
  refreshWorkspace,
  reportFailure,
  toConversation,
  toProject,
} from "./live";
import { useStore } from "./sim/store";
import type {
  Classification,
  Conversation,
  ExportResult,
  ImportResult,
  Project,
  ProviderType,
  SearchHit,
  Settings,
} from "@/lib/types";

const s = () => useStore.getState();
const toast = (kind: "info" | "deny", title: string, description?: string) => s().toast({ kind, title, description });

/** Recovery key length without hyphens: the backend's is 9 groups of 4 (Recovery Package v1). */
const LIVE_KEY_LENGTH = 36;
const SIM_KEY_LENGTH = 32;

export type IssueResult = { ok: true; key: string } | { ok: false; alreadyIssued: boolean; error: string };
export type RestoreResult = { ok: true; epoch: number | null } | { ok: false; error: string };
export type SendResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no_model" | "too_large" | "busy" | "company_unreachable" | "model_missing" | "error";
      detail?: string | undefined;
    };

/** The settings a user can change; the rest are results of checks. */
export type SettingsChange = Partial<
  Pick<Settings, "update_check" | "catalogue_check" | "safe_mode_cpu" | "default_model_id">
>;

async function updateSettings(patch: SettingsChange): Promise<void> {
  if (!isLive()) {
    s().updateSettings(patch);
    return;
  }
  try {
    const saved = await bridge().settings.update(patch);
    s().updateSettings(patch); // keeps the engine state shown in step (Safe mode)
    applySettings(saved);
  } catch (err) {
    reportFailure(err, "Setting not saved");
  }
}

/** Suggested file name for a project package: the project name, safe as a file name on every OS. */
function packageFileName(projectId: string): string {
  const name = s().projects.find((p) => p.id === projectId)?.name ?? "project";
  const safe =
    name
      .replace(/[^A-Za-z0-9 ._-]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "project";
  return `${safe}.aiosproj`;
}

const afterConversation = (id: string) => () => Promise.all([refreshConversation(id), refreshEvents()]);

export const api = {
  /** GET /health */
  health: () => s().health,

  /** GET /projects, POST /projects, PATCH /projects/{id}, DELETE /projects/{id} */
  projects: {
    list: () => s().projects,
    create: async (input: { name: string; classification: Classification }): Promise<Project | undefined> => {
      if (!isLive()) return s().createProject(input);
      const created = await change("Project not created", () => bridge().projects.create(input));
      return created && toProject(created);
    },
    rename: (id: string, name: string) =>
      isLive()
        ? void change("Not renamed", () => bridge().projects.update(id, { name }), refreshProjects)
        : s().renameProject(id, name),
    archive: (id: string, archived = true) =>
      isLive()
        ? void change("Not archived", () => bridge().projects.update(id, { archived }), refreshProjects)
        : s().archiveProject(id, archived),
    remove: (id: string) =>
      isLive() ? void change("Project not deleted", () => bridge().projects.remove(id)) : s().deleteProject(id),
    /** Reclassify: lowering creates a reviewed copy with provenance (M-04). */
    reclassify: async (
      id: string,
      to: Classification,
    ): Promise<{ project: Project; reviewedCopy: boolean } | undefined> => {
      if (!isLive()) return s().reclassifyProject(id, to);
      const out = await change("Class not changed", () => bridge().projects.reclassify(id, to));
      return out && { project: toProject(out.project), reviewedCopy: out.reviewed_copy };
    },
    setCompanyAi: (id: string, enabled: boolean, confirmed: boolean) =>
      isLive()
        ? void change("Not changed", () => bridge().projects.setCompanyAi(id, enabled, confirmed), refreshProjects)
        : s().setProjectCompanyAi(id, enabled, confirmed),
    /** POST /projects/{id}/export. The desktop app asks where to save; the dialog confirmed already. */
    exportPackage: async (id: string): Promise<ExportResult> => {
      if (!isLive()) return s().exportProject(id);
      let result;
      try {
        result = await bridge().projects.exportPackage(id, { file_name: packageFileName(id), confirmed: true });
      } catch (err) {
        throw new Error(messageFor(err));
      }
      if (!result) throw new Error("No file was chosen. Nothing was written.");
      await refreshEvents();
      return result;
    },
    /** Desktop app: the system open dialog for a .aiosproj file. Null in a browser or when cancelled. */
    choosePackage: async (): Promise<PickedFile | null> => (isLive() ? bridge().projects.choosePackage() : null),
    /** POST /projects/import */
    importPackage: async (
      path?: string,
    ): Promise<{ ok: true; result: ImportResult } | { ok: false; error: string }> => {
      if (!isLive() || !path) return s().importProject();
      try {
        const result = await bridge().projects.importPackage(path);
        await refreshWorkspace();
        return { ok: true, result };
      } catch (err) {
        return { ok: false, error: messageFor(err) };
      }
    },
    /** GET /projects/{id}/evidence */
    evidence: (id: string) => s().events.filter((e) => e.project_id === id),
    /** POST /evidence/export: needs the evidence writer, which is not in this build. */
    exportEvidence: async (scope: { project_id: string } | { from: string; to: string }) => {
      if (!isLive()) return s().exportEvidence(scope);
      try {
        await bridge().evidence.export();
      } catch (err) {
        throw new Error(messageFor(err));
      }
      throw new Error(messageFor(new Error("writer_unavailable"))); // the backend never answers 200 yet
    },
  },

  /** GET, POST, PATCH, DELETE /projects/{id}/conversations */
  conversations: {
    list: (projectId: string) => s().conversations.filter((c) => c.project_id === projectId),
    create: async (projectId: string, title?: string | undefined): Promise<Conversation | undefined> => {
      if (!isLive()) return s().createConversation(projectId, title);
      const created = await change(
        "Conversation not started",
        () => bridge().conversations.create(projectId, title),
        () => Promise.all([refreshConversations([projectId]), refreshEvents()]),
      );
      if (!created) return undefined;
      const conv = toConversation(created);
      useStore.setState((st) => ({ conversations: [...st.conversations.filter((c) => c.id !== conv.id), conv] }));
      return conv;
    },
    rename: (id: string, title: string) =>
      isLive()
        ? void change("Not renamed", () => bridge().conversations.update(id, { title }), afterConversation(id))
        : s().renameConversation(id, title),
    archive: (id: string, archived = true) =>
      isLive()
        ? void change("Not archived", () => bridge().conversations.update(id, { archived }), afterConversation(id))
        : s().archiveConversation(id, archived),
    remove: (id: string) =>
      isLive()
        ? void change("Conversation not deleted", () => bridge().conversations.remove(id))
        : s().deleteConversation(id),
    setModel: (id: string, modelId: string) =>
      isLive()
        ? void change(
            "Model not changed",
            () => bridge().conversations.update(id, { model_id: modelId }),
            afterConversation(id),
          )
        : s().setConversationModel(id, modelId),
    /** POST /conversations/{id}/provider, with the confirmation rules (M-09). */
    setProvider: (id: string, to: ProviderType, confirmed: boolean) =>
      isLive()
        ? void change(
            "Provider not changed",
            () => bridge().conversations.setProvider(id, to, confirmed),
            async () => {
              await afterConversation(id)();
              await loadMessages(id);
            },
          )
        : s().moveConversation(id, to, confirmed),
    /** GET /conversations/{id}/messages: loads them into the store when a conversation opens. */
    load: (id: string) =>
      isLive() ? loadMessages(id).catch((err: unknown) => reportFailure(err, "Messages not loaded")) : undefined,
    messages: (id: string) => s().messages.filter((m) => m.conversation_id === id),
    /** POST /conversations/{id}/messages */
    send: async (id: string, text: string): Promise<SendResult> => {
      if (!isLive()) return s().sendMessage(id, text);
      try {
        await bridge().conversations.send(id, text);
        // refreshHealth: a GPU-to-CPU fallback during this answer shows its notice now (D-06).
        await Promise.all([loadMessages(id), afterConversation(id)(), refreshHealth()]);
        return { ok: true };
      } catch (err) {
        await Promise.all([loadMessages(id), refreshEvents()]).catch(() => undefined); // a refusal is recorded
        const code = errorCode(err);
        if (code === "message_too_large") return { ok: false, reason: "too_large", detail: messageFor(err) };
        return { ok: false, reason: "error", detail: messageFor(err) };
      }
    },
    /** POST /conversations/{id}/stop: answers are not streamed in the desktop build yet. */
    stop: () => (isLive() ? undefined : s().stopGeneration()),
    regenerate: (id: string) =>
      isLive()
        ? void change(
            "Not regenerated",
            () => bridge().conversations.regenerate(id),
            async () => {
              await loadMessages(id);
              await Promise.all([refreshEvents(), refreshHealth()]);
            },
          )
        : s().regenerate(id),
    /** Offer local continuation for an interrupted Company answer (M-09). */
    offerContinueLocally: (id: string, partialMessageId: string) =>
      isLive() ? undefined : s().offerContinueLocally(id, partialMessageId),
  },

  /** GET /providers/status */
  providers: {
    status: () => ({
      local_ready: s().health.engine === "ready" || s().health.engine === "idle_unloaded",
      company: s().health.company,
    }),
  },

  /** GET /system/hardware, GET /system/network */
  system: {
    hardware: () => s().hardware,
    /** Needs the local engine, which is not in the desktop build yet. */
    benchmark: async () => {
      if (!isLive()) return s().runBenchmark();
      await refreshModels(true).catch(() => undefined);
      toast("info", "Benchmark not run", "The benchmark needs the local engine, which is not part of this build yet.");
    },
    dismissFallbackNotice: () => s().dismissFallbackNotice(),
  },

  /** GET /models, POST /models/download, POST /models/import, DELETE /models/{id} */
  models: {
    installed: () => s().installedModels,
    download: (entryId: string) =>
      isLive()
        ? void bridge()
            .models.download(entryId)
            .catch((err: unknown) => reportFailure(err, "Download not started"))
        : s().startDownload(entryId),
    pause: (entryId: string) => s().pauseDownload(entryId),
    resume: (entryId: string) => s().resumeDownload(entryId),
    cancel: (entryId: string) => s().cancelDownload(entryId),
    /** Pick a .gguf file; it is installed only if it is this catalogue entry byte for byte. */
    importOffline: async (entryId: string): Promise<void> => {
      if (!isLive()) return s().importModel(entryId);
      const file = await bridge().models.chooseFile();
      if (!file) return;
      toast("info", "Checking the model file", `${file.file_name} is compared with the catalogue (size and SHA-256).`);
      const model = await change(
        "Model not installed",
        () => bridge().models.importFile(file.path, entryId),
        () => Promise.all([refreshModels(), refreshEvents(), refreshSettings()]),
      );
      if (model)
        s().toast({
          kind: "success",
          title: `${model.name} installed`,
          description: "Verified against the catalogue.",
        });
    },
    remove: async (id: string): Promise<{ ok: true } | { ok: false; reason: string }> => {
      if (!isLive()) return s().deleteModel(id);
      try {
        await bridge().models.remove(id);
        await Promise.all([refreshModels(), refreshEvents(), refreshSettings()]);
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: messageFor(err) };
      }
    },
    setDefault: (id: string | null) => {
      s().setDefaultModel(id);
      if (isLive()) void updateSettings({ default_model_id: id });
    },
  },

  /** GET /search?q= (the browser simulation searches the store) */
  search: async (q: string): Promise<SearchHit[]> => (isLive() ? bridge().search.query(q) : s().search(q)),

  /** GET, PATCH /settings; POST /settings/update-check (through Electron main's updater) */
  settings: {
    get: () => s().settings,
    update: updateSettings,
    checkForUpdates: async () => {
      if (!isLive()) return s().checkForUpdates();
      try {
        applySettings(await bridge().settings.checkForUpdates());
      } catch (err) {
        reportFailure(err, "Update check failed");
      }
    },
    installUpdate: () => s().installUpdate(),
  },

  /** POST /restore */
  restore: async (input: {
    backup_path: string;
    recovery_key: string;
    has_package: boolean;
  }): Promise<RestoreResult> => {
    if (!isLive()) return s().restore(input);
    try {
      await bridge().setup.restore({ backup_path: input.backup_path, recovery_key: input.recovery_key });
      await refreshStatus();
      await refreshSettings();
      await refreshWorkspace();
      return { ok: true, epoch: null }; // epochs are numbered by the evidence writer (not built yet)
    } catch (err) {
      return { ok: false, error: messageFor(err) };
    }
  },

  /** Restore screen helpers. */
  backup: {
    /** Real folder dialog in the desktop app; null in a browser, where the screen offers sample folders. */
    canChooseFolder: () => isLive(),
    chooseFolder: async (): Promise<BackupFolder | null> => (isLive() ? bridge().setup.chooseBackupFolder() : null),
    keyLength: () => (isLive() ? LIVE_KEY_LENGTH : SIM_KEY_LENGTH),
  },

  /** GET /setup/status, POST /setup/store, POST /setup/complete */
  firstRun: {
    /** Setup opens: clear any old simulated workspace, keep a setup already in progress. */
    begin: () => {
      const { ui, resetFirstRun } = s();
      if (!ui.freshInstall || ui.firstRunComplete) resetFirstRun("fresh");
      if (isLive())
        void Promise.all([refreshSettings(), refreshModels(true)]).catch((err: unknown) =>
          reportFailure(err, "Could not load this machine's details"),
        );
    },
    /** Creates the store; the key comes back exactly once. */
    issueRecoveryKey: async (): Promise<IssueResult> => {
      if (!isLive()) return { ok: true, key: s().issueRecoveryKey() };
      try {
        const created = await bridge().setup.createStore();
        useStore.setState((st) => ({
          recoveryKey: created.recovery_key,
          stream: { ...st.stream, stream_id: created.stream_id, signer_key_id: created.signing_key_id },
        }));
        return { ok: true, key: created.recovery_key };
      } catch (err) {
        const error = messageFor(err);
        return { ok: false, alreadyIssued: errorCode(err) === "store_exists", error };
      }
    },
    complete: async (input: { installedModelId: string | null }): Promise<boolean> => {
      if (!isLive()) {
        s().completeFirstRun(input);
        return true;
      }
      try {
        const done = await bridge().setup.complete();
        await refreshStatus();
        await refreshWorkspace();
        useStore.setState((st) => ({
          ui: { ...st.ui, firstRunComplete: true, lastProjectId: done.default_project_id },
        }));
        return true;
      } catch (err) {
        reportFailure(err, "Setup could not finish");
        return false;
      }
    },
  },
};
