import { FallbackNotice } from "@/components/app/FallbackNotice";
import { useNavigate } from "react-router";
import { ArrowRight, Cpu } from "lucide-react";
import { api } from "@/bridge/api";
import { selectModelName, useStore } from "@/bridge/sim/store";
import { formatBytes } from "@/lib/format";
import { useEngineStatus } from "@/components/app/useEngineStatus";
import { Button } from "@/components/ui/button";
import { Select, Switch } from "@/components/ui/fields";
import { EmptyState } from "@/components/ui/feedback";
import { Ledger, PanelNote, SettingGroup, SettingPanel, SettingRow } from "@/components/app/SettingRow";
import { ComponentRow } from "./shared";

/** Engine: Safe mode (D-06, AC-09), engine state, default model (M-03). */
export function EngineSection() {
  const settings = useStore((s) => s.settings);
  const health = useStore((s) => s.health);
  const hardware = useStore((s) => s.hardware);
  const installed = useStore((s) => s.installedModels);
  const loadedName = useStore(selectModelName(health.loaded_model_id));
  const engine = useEngineStatus();
  const navigate = useNavigate();

  const gpu = hardware.gpu;
  const modelInMemory = health.engine === "ready" || health.engine === "generating" || health.engine === "loading";

  return (
    <>
      <FallbackNotice />

      <SettingGroup title="Safe mode (CPU)">
        <SettingPanel>
          <SettingRow
            htmlFor="settings-safe-mode"
            label="Safe mode"
            hint="Always use the CPU build of the engine. Slower, but avoids graphics driver problems. Takes effect on the next answer."
            control={
              <Switch
                id="settings-safe-mode"
                checked={settings.safe_mode_cpu}
                onCheckedChange={(v) => api.settings.update({ safe_mode_cpu: v })}
              />
            }
          />
          {!gpu && (
            <PanelNote icon={<Cpu />}>
              This machine has no graphics card AIOS can use, so the engine runs on the CPU build either way.
            </PanelNote>
          )}
          {gpu && !gpu.driver_ok && (
            <PanelNote tone="caution" icon={<Cpu />}>
              Graphics driver not responding. The CPU build is used until the driver is updated.
            </PanelNote>
          )}
        </SettingPanel>
      </SettingGroup>

      <SettingGroup title="Engine">
        <SettingPanel>
          <ComponentRow
            as="div"
            tone={engine.tone}
            pulse={engine.pulse}
            name="Local engine"
            status={engine.label}
            detail={engine.detail}
          />
          <Ledger
            dense
            rows={[
              {
                k: "Build",
                v: health.engine_build === "vulkan" ? "GPU (Vulkan)" : settings.safe_mode_cpu ? "CPU (Safe mode)" : "CPU",
                mono: true,
              },
              {
                k: "Loaded model",
                v:
                  modelInMemory && health.loaded_model_id ? (
                    loadedName
                  ) : (
                    <span className="text-ink-50">None loaded</span>
                  ),
              },
            ]}
          />
          <PanelNote>
            The engine starts when a conversation needs it and unloads after five minutes idle to free memory.
          </PanelNote>
        </SettingPanel>
      </SettingGroup>

      <SettingGroup title="Default model">
        <SettingPanel>
          {installed.length === 0 ? (
            <EmptyState
              compact
              icon={<Cpu />}
              title="No model installed"
              description="Chat needs a local model. Everything else works without one: your history, search, export and the evidence log."
              action={
                <Button variant="primary" size="sm" onClick={() => navigate("/models")}>
                  Install a model
                </Button>
              }
            />
          ) : (
            <SettingRow
              htmlFor="settings-default-model"
              label="Default model for new conversations"
              hint="New conversations start on this model. Each conversation can still choose its own from the composer."
              control={
                <Select
                  id="settings-default-model"
                  className="w-60"
                  value={settings.default_model_id ?? undefined}
                  onValueChange={(v) => api.models.setDefault(v)}
                  placeholder="Choose a model"
                  options={installed.map((m) => ({
                    value: m.id,
                    label: m.name,
                    description: `${m.tier === "small" ? "Small" : "Medium"} tier · ${formatBytes(m.size_bytes)} · ${m.context_length.toLocaleString()} token context`,
                  }))}
                />
              }
            />
          )}
          <SettingRow
            label="Installed models"
            hint="Install, import or remove models in the model manager."
            control={
              <Button trailing={<ArrowRight className="size-3.5" />} onClick={() => navigate("/models")}>
                Manage models
              </Button>
            }
          />
        </SettingPanel>
      </SettingGroup>
    </>
  );
}
