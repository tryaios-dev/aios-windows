/**
 * Display metadata for Evidence Wire Format v1 event types: label, icon,
 * filter group, and a one-line context summary built from the content-free
 * payload. Nothing here reads content; the log never holds any.
 */
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArrowRightLeft,
  Database,
  Download,
  FileDown,
  FileUp,
  FolderMinus,
  FolderPlus,
  GitBranch,
  KeyRound,
  MessageSquare,
  MessageSquareX,
  Package,
  Power,
  RotateCcw,
  Shield,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { Classification, EventType, EvidenceEvent } from "@/lib/types";
import { formatBytes } from "@/lib/format";
import { shortHash } from "@/lib/hash";
import { CLASS_META } from "@/components/ui/chips";

export type FilterGroup = "requests" | "models" | "projects" | "providers" | "transfer" | "restore" | "system";

export interface EventMeta {
  label: string;
  icon: LucideIcon;
  group: FilterGroup;
}

export const FILTER_GROUPS: Array<{ key: FilterGroup; label: string }> = [
  { key: "requests", label: "Requests" },
  { key: "models", label: "Models" },
  { key: "projects", label: "Projects" },
  { key: "providers", label: "Providers" },
  { key: "transfer", label: "Export and import" },
  { key: "restore", label: "Restore" },
  { key: "system", label: "System" },
];

export const EVENT_META: Record<EventType, EventMeta> = {
  request: { label: "Request", icon: MessageSquare, group: "requests" },
  model_installed: { label: "Model installed", icon: Download, group: "models" },
  model_deleted: { label: "Model deleted", icon: Trash2, group: "models" },
  project_created: { label: "Project created", icon: FolderPlus, group: "projects" },
  project_reclassified: { label: "Class changed", icon: Shield, group: "projects" },
  project_deleted: { label: "Project deleted", icon: FolderMinus, group: "projects" },
  conversation_created: { label: "Conversation started", icon: MessageSquare, group: "projects" },
  conversation_deleted: { label: "Conversation deleted", icon: MessageSquareX, group: "projects" },
  disclosure_confirmed: { label: "Disclosure confirmed", icon: ShieldAlert, group: "providers" },
  provider_changed: { label: "Provider changed", icon: ArrowRightLeft, group: "providers" },
  export: { label: "Export", icon: FileDown, group: "transfer" },
  import: { label: "Import", icon: FileUp, group: "transfer" },
  restore: { label: "Restore", icon: RotateCcw, group: "restore" },
  continuation: { label: "Continuation", icon: GitBranch, group: "restore" },
  key_rotation: { label: "Key rotation", icon: KeyRound, group: "restore" },
  refusal: { label: "Refusal", icon: ShieldAlert, group: "system" },
  install: { label: "Install", icon: Package, group: "system" },
  store_created: { label: "Store created", icon: Database, group: "system" },
  recovery_package_written: { label: "Recovery package written", icon: Archive, group: "system" },
  recovery_key_issued: { label: "Recovery key issued", icon: KeyRound, group: "system" },
  shutdown: { label: "Shutdown", icon: Power, group: "system" },
};

export const ACTOR_LABEL: Record<EvidenceEvent["actor"], string> = {
  user: "User",
  app: "AIOS (app)",
  operator: "Operator",
};

/** `#0042` for any sequence number. */
export function formatSeq(seq: number): string {
  return `#${String(seq).padStart(4, "0")}`;
}

/** `#0012–#0057` for a closed range. */
export function formatSeqRange(from: number, to: number): string {
  return from === to ? formatSeq(from) : `${formatSeq(from)}–${formatSeq(to)}`;
}

export interface ContextLookups {
  conversationTitle: (id: string) => string | undefined;
  projectName: (id: string) => string | undefined;
  modelName: (digest?: string | undefined, entryId?: string | undefined) => string | undefined;
}

const classLabel = (v: unknown) =>
  typeof v === "string" && v in CLASS_META ? CLASS_META[v as Classification].label : typeof v === "string" ? v : "";

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

/**
 * One line that says what the event was about without showing any content.
 * Conversation titles are looked up live; a deleted conversation reads as removed.
 */
export function eventContext(e: EvidenceEvent, lookups: ContextLookups): string {
  const p = e.payload ?? {};
  const conv = e.conversation_id ? lookups.conversationTitle(e.conversation_id) : undefined;
  const project = e.project_id ? lookups.projectName(e.project_id) : undefined;
  const model = lookups.modelName(e.model_digest, str(p.entry_id));

  switch (e.event_type) {
    case "request": {
      const title = conv ?? "Conversation removed";
      if (p.purpose === "summary") return `${title} · background summary`;
      if (p.regenerate === true) return `${title} · regenerated`;
      if (p.status && p.status !== "complete") return `${title} · ${String(p.status)}`;
      return title;
    }
    case "model_installed":
      return `${model ?? "Model"} · ${p.source === "offline" ? "offline import" : "download"}${num(p.size_bytes) ? ` · ${formatBytes(num(p.size_bytes)!)}` : ""}`;
    case "model_deleted":
      return `${model ?? "Model"} · removed from this device`;
    case "project_created":
      return `${project ?? "Project removed"} · ${classLabel(p.classification) || "Restricted"}${p.default === true ? " · default project" : ""}`;
    case "project_reclassified": {
      const from = classLabel(p.from_class);
      const to = classLabel(p.to_class);
      const how = p.reviewed_copy === true ? "reviewed copy" : "in place";
      return from && to ? `${from} → ${to}, ${how}` : `${project ?? "Project"} · class changed, ${how}`;
    }
    case "project_deleted": {
      const n = num(p.conversations);
      return `${project ?? "Project removed"}${n !== undefined ? ` · ${n} conversation${n === 1 ? "" : "s"}` : ""}`;
    }
    case "conversation_created":
      return conv ?? "Conversation removed";
    case "conversation_deleted":
      return conv ?? "Conversation removed";
    case "disclosure_confirmed":
      return `${conv ? `${conv} · ` : ""}moving to Company AI was confirmed`;
    case "provider_changed": {
      if (p.scope === "project_default")
        return `Company AI for new conversations · ${p.enabled === true ? "on" : "off"}`;
      const from = p.from === "company" ? "Company" : "Local";
      const to = (p.to ?? e.provider) === "company" ? "Company" : "Local";
      const note = p.history_sent === true ? "history sent" : "nothing sent";
      return `${conv ? `${conv} · ` : ""}${from} → ${to} · ${note}`;
    }
    case "export": {
      if (p.kind === "evidence") {
        const a = num(p.first_seq);
        const b = num(p.last_seq);
        return `Evidence · ${a !== undefined && b !== undefined ? formatSeqRange(a, b) : (str(p.scope) ?? "range")}${num(p.checkpoints) !== undefined ? ` · ${num(p.checkpoints)} checkpoint${num(p.checkpoints) === 1 ? "" : "s"}` : ""}`;
      }
      return `Project package${p.file_name ? ` · ${String(p.file_name)}` : project ? ` · ${project}` : ""}`;
    }
    case "import": {
      const c = num(p.conversations);
      const m = num(p.messages);
      const parts = [`Project package`];
      if (c !== undefined) parts.push(`${c} conversation${c === 1 ? "" : "s"}`);
      if (m !== undefined) parts.push(`${m} message${m === 1 ? "" : "s"}`);
      if (p.remapped === true) parts.push("identifiers remapped");
      return parts.join(" · ");
    }
    case "restore":
      return `From backup${p.backup_path ? ` · ${String(p.backup_path)}` : ""}${p.restored_tip ? ` · tip ${shortHash(String(p.restored_tip), 6, 4)}` : ""}`;
    case "continuation":
      return `Epoch ${num(p.epoch) ?? e.epoch}${p.new_signer_key_id ? ` · new signer ${shortHash(String(p.new_signer_key_id), 6, 4)}` : ""}`;
    case "key_rotation":
      return `Signer key rotated${p.new_signer_key_id ? ` · ${shortHash(String(p.new_signer_key_id), 6, 4)}` : ""}`;
    case "refusal":
      return str(p.reason) ?? "Request refused";
    case "install":
      return `AIOS ${str(p.app_version) ?? ""}${p.installer ? ` · ${String(p.installer)}` : ""}`.trim();
    case "store_created":
      return `chats.db · schema v${str(p.schema_version) ?? "1"}`;
    case "recovery_package_written":
      return `Recovery Package v${str(p.package_version) ?? "1"}`;
    case "recovery_key_issued":
      return "Shown once, never stored";
    case "shutdown":
      return p.checkpoint === true ? "Clean shutdown · checkpoint signed" : "Clean shutdown";
    default:
      return "";
  }
}

/** Payload values rendered for the detail sheet, in insertion order. */
export function payloadRows(e: EvidenceEvent): Array<{ key: string; value: string }> {
  const p = e.payload;
  if (!p) return [];
  return Object.entries(p).map(([key, v]) => ({
    key,
    value: v === null ? "null" : typeof v === "number" && key === "size_bytes" ? `${v} (${formatBytes(v)})` : String(v),
  }));
}
