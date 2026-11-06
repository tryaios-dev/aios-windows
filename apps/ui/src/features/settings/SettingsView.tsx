import { motion } from "motion/react";
import { NavLink, Navigate, useParams } from "react-router";
import { useStore } from "@/bridge/sim/store";
import { cn } from "@/lib/cn";
import { PageBody, PageHeader } from "@/components/ui/layout";
import { SECTION_META, SETTINGS_SECTIONS, isSettingsSection, type SettingsSection } from "./sections";
import { SectionHeader } from "@/components/app/SettingRow";
import { GeneralSection } from "./GeneralSection";
import { EngineSection } from "./EngineSection";
import { NetworkSection } from "./NetworkSection";
import { HardwareSection } from "./HardwareSection";
import { HealthSection } from "./HealthSection";
import { DataSection } from "./DataSection";
import { AboutSection } from "./AboutSection";

/**
 * Settings (S15: M-18, M-21, M-22, AC-21). A global screen: a table-of-contents
 * column on the left, one section at a time on the right. /settings opens General.
 * The frame stays still; only the content column fades and rises on a change.
 */
export function SettingsView() {
  const { section: param } = useParams();
  const updateAvailable = useStore((s) => !!s.settings.update_available);
  const needsAttention = useStore(
    (s) => s.health.writer === "unavailable" || s.health.engine === "failed" || s.health.backend !== "ok",
  );

  if (param !== undefined && !isSettingsSection(param)) return <Navigate to="/settings" replace />;
  const section: SettingsSection = param ?? "general";
  const meta = SECTION_META[section];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Settings"
        description="Settings for this installation. Each project keeps its own under Project settings."
      />
      <PageBody width="max-w-[952px]">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-18">
          <nav aria-label="Settings sections" className="md:sticky md:top-6 md:w-52 md:shrink-0">
            <div className="label-mono mb-2 px-2.5">Settings</div>
            <ul className="flex flex-wrap gap-1 md:flex-col md:gap-px">
              {SETTINGS_SECTIONS.map((id) => {
                const item = SECTION_META[id];
                const Icon = item.icon;
                const active = id === section;
                const dot = (id === "general" && updateAvailable) || (id === "health" && needsAttention);
                const dotLabel = id === "general" ? "Update waiting" : "Needs attention";
                return (
                  <li key={id}>
                    <NavLink
                      // Bare /settings is General, so its link points there while that is the URL.
                      to={id === "general" && param === undefined ? "/settings" : `/settings/${id}`}
                      end
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-(--duration-micro)",
                        active
                          ? "bg-white font-medium text-ink ring-1 ring-line"
                          : "text-ink-soft hover:bg-ink-6 hover:text-ink",
                        "before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-green before:opacity-0 before:transition-opacity before:duration-(--duration-micro)",
                        active && "before:opacity-100",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-4 shrink-0",
                          active ? "text-green" : "text-ink-50 group-hover:text-ink-soft",
                        )}
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {dot && (
                        <span className="size-1.5 shrink-0 rounded-full bg-brass" role="img" aria-label={dotLabel} />
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </nav>

          <motion.div
            key={section}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
            className="min-w-0 flex-1 md:max-w-2xl"
          >
            <SectionHeader title={meta.label} description={meta.description} />
            <div className="mt-6 flex flex-col gap-8">
              {section === "general" && <GeneralSection />}
              {section === "engine" && <EngineSection />}
              {section === "network" && <NetworkSection />}
              {section === "hardware" && <HardwareSection />}
              {section === "health" && <HealthSection />}
              {section === "data" && <DataSection />}
              {section === "about" && <AboutSection />}
            </div>
          </motion.div>
        </div>
      </PageBody>
    </div>
  );
}
