import { FallbackNotice } from "@/components/app/FallbackNotice";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Cpu } from "lucide-react";
import { api } from "@/bridge/api";
import { useStore } from "@/bridge/sim/store";
import type { InstalledModel } from "@/lib/types";
import { formatBytes } from "@/lib/format";
import { CATALOGUE, installable } from "@/bridge/sim/catalogue";
import { Button } from "@/components/ui/button";
import { Hint, Select } from "@/components/ui/fields";
import { EmptyState } from "@/components/ui/feedback";
import { Card, CardHeader, PageBody, PageHeader, SectionLabel } from "@/components/ui/layout";
import { MachineCard } from "./MachineCard";
import { ModelCard } from "./ModelCard";
import { contextLabel, shortAgo, tierLabel } from "./modelHelpers";

/** Model manager, route /models (S13, S14). Catalogue, install, import, delete, default model, hardware. */
export function ModelsView() {
  const navigate = useNavigate();
  const installed = useStore((s) => s.installedModels);
  const catalogueVersion = useStore((s) => s.settings.catalogue_version);
  const lastCheck = useStore((s) => s.settings.last_catalogue_check);

  // Installed entries first; the catalogue order is kept otherwise. Only entries that may be
  // installed are listed: a third-party file needs a passed review first (MVP 9.6), the same
  // rule the backend applies to a download.
  const entries = useMemo(() => {
    const isInstalled = (id: string) => installed.some((m) => m.catalogue_entry_id === id);
    return CATALOGUE.filter(installable).sort(
      (a, b) => Number(isInstalled(b.entry_id)) - Number(isInstalled(a.entry_id)),
    );
  }, [installed]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Models"
        description="Models install only from the signed catalogue. Every file is checked against its digest and provenance record before it is used."
      />
      <PageBody width="max-w-4xl">
        <div className="flex flex-col gap-6">
          <FallbackNotice className="animate-rise" />

          <MachineCard />
          <DefaultModelCard installed={installed} />

          <section aria-labelledby="catalogue-label">
            <SectionLabel right={lastCheck ? `Checked ${shortAgo(lastCheck)}` : "Not checked yet"}>
              <span id="catalogue-label">Model Catalogue v1 · {catalogueVersion} · signed</span>
            </SectionLabel>
            {entries.length === 0 ? (
              <Card className="mt-3">
                <EmptyState
                  compact
                  icon={<Cpu />}
                  title="The catalogue has no entries"
                  description="This version of the signed catalogue lists no models. Check for a catalogue update in Settings."
                  action={
                    <Button size="sm" onClick={() => navigate("/settings/general")}>
                      Open Settings
                    </Button>
                  }
                />
              </Card>
            ) : (
              <ul className="mt-3 flex flex-col gap-3" aria-label="Model catalogue">
                {entries.map((entry, i) => (
                  <li key={entry.entry_id}>
                    <ModelCard
                      entry={entry}
                      installed={installed.find((m) => m.catalogue_entry_id === entry.entry_id)}
                      index={i}
                    />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs leading-4.5 text-ink-50">
              Only models under licences that allow commercial redistribution enter the catalogue. Adding a model means
              an application update in this version.
            </p>
          </section>
        </div>
      </PageBody>
    </div>
  );
}

/** Default model for new conversations (MVP 4.3). Per-conversation choice lives in the composer. */
function DefaultModelCard({ installed }: { installed: InstalledModel[] }) {
  const defaultId = useStore((s) => s.settings.default_model_id);
  const options = installed.map((m) => ({
    value: m.id,
    label: m.name,
    description: `${tierLabel(m.tier)} · ${contextLabel(m.context_length)} · ${formatBytes(m.size_bytes)}`,
  }));
  const none = installed.length === 0;

  return (
    <Card className="animate-rise">
      <CardHeader
        title="Default for new conversations"
        description="Every new conversation starts on this model and shows it in the answer badge."
      />
      <div className="mt-4 max-w-sm">
        <Select
          id="default-model"
          aria-label="Default model for new conversations"
          value={defaultId ?? ""}
          onValueChange={(v) => api.models.setDefault(v)}
          options={options}
          placeholder={none ? "No model installed" : "Choose a model"}
          disabled={none}
        />
        <Hint className="mt-1.5">
          {none
            ? "Install a model from the catalogue below. Chat is unavailable until then; everything else works."
            : "Existing conversations keep their model until you change it in the composer."}
        </Hint>
      </div>
    </Card>
  );
}
