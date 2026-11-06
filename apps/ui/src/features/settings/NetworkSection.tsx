import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
import { selectAllowlist, useStore, useStoreShallow } from "@/bridge/sim/store";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/feedback";
import { Ledger, PanelNote, PathValue, SettingGroup, SettingPanel, SettingRow } from "@/components/app/SettingRow";
import { platform } from "@/lib/platform";

/** Network: the allowlist and its schedule (M-22, AC-21), company server status (M-10). */
export function NetworkSection() {
  const allowlist = useStoreShallow(selectAllowlist);
  const companyFlag = useStore((s) => s.sim.companyFlag);
  const company = useStore((s) => s.health.company);
  const settings = useStore((s) => s.settings);
  const navigate = useNavigate();

  return (
    <>
      <SettingGroup
        title="Allowed destinations"
        description="AIOS contacts only these hosts, at declared times. Nothing else, and nothing without a reason you can see here."
      >
        <SettingPanel>
          {allowlist.length === 0 ? (
            <EmptyState compact title="No destinations" description="This build contacts no host at all." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft">
                    <th scope="col" className="label-mono h-9 px-4 text-left font-normal">
                      Host
                    </th>
                    <th scope="col" className="label-mono h-9 pr-4 text-left font-normal">
                      Purpose
                    </th>
                    <th scope="col" className="label-mono h-9 pr-4 text-left font-normal">
                      Kind
                    </th>
                    <th scope="col" className="label-mono h-9 pr-4 text-left font-normal">
                      Enabled
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {allowlist.map((e) => (
                    <tr key={e.host} className="align-top">
                      <td className="py-3 pl-4 pr-4">
                        <span className="whitespace-nowrap font-mono text-xs tracking-[0.02em] text-ink">{e.host}</span>
                      </td>
                      <td className="py-3 pr-4 text-xs leading-4.5 text-ink-soft">{e.purpose}</td>
                      <td className="py-3 pr-4">
                        <Badge tone={e.kind === "fixed" ? "neutral" : "slate"}>
                          {e.kind === "fixed" ? "Fixed in build" : "Configured"}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs leading-4.5 text-ink-soft">
                          <StatusDot tone={e.enabled ? "green" : "neutral"} />
                          {e.enabled ? "On" : "Off"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <PanelNote>Enforced by the application, not by the operating system, in this version.</PanelNote>
        </SettingPanel>
      </SettingGroup>

      <SettingGroup
        title="Schedule"
        description="Update feed and catalogue: at start and at most once a day, unless switched off in General."
      >
        <SettingPanel>
          <Ledger
            rows={[
              {
                k: "Update feed",
                v: <ScheduleValue on={settings.update_check}>At start and at most once a day</ScheduleValue>,
              },
              {
                k: "Model catalogue",
                v: <ScheduleValue on={settings.catalogue_check}>At start and at most once a day</ScheduleValue>,
              },
              { k: "Model downloads", v: "Only when you start one in Models. A download resumes where it stopped." },
              ...(companyFlag ? [{ k: "Company AI server", v: "Only while a conversation runs on Company AI." }] : []),
            ]}
          />
          <SettingRow
            label="Automatic checks"
            hint="Both switches live in General."
            control={
              <Button trailing={<ArrowRight className="size-3.5" />} onClick={() => navigate("/settings/general")}>
                Change the checks in General
              </Button>
            }
          />
        </SettingPanel>
      </SettingGroup>

      {companyFlag && (
        <SettingGroup title="Company AI server">
          <SettingPanel>
            <Ledger
              rows={[
                { k: "Base URL", v: <PathValue value={company.base_url} /> },
                { k: "Model", v: company.model_name },
                {
                  k: "Reachable",
                  v: (
                    <span className="inline-flex items-center gap-1.5 text-ink-soft">
                      <StatusDot tone={company.reachable ? "green" : "deny"} />
                      {company.reachable ? "Reachable now" : "Not reachable at the moment"}
                    </span>
                  ),
                },
              ]}
            />
            <PanelNote>
              Set by an operator in the configuration file. The API key is held in {platform.keyStore} and read only by
              the gateway.
            </PanelNote>
          </SettingPanel>
        </SettingGroup>
      )}
    </>
  );
}

function ScheduleValue({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>{children}</span>
      <Badge tone={on ? "green" : "neutral"}>{on ? "On" : "Off"}</Badge>
    </span>
  );
}
