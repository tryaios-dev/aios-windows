import { Cpu } from "lucide-react";
import { api } from "@/bridge/api";
import { useStore } from "@/bridge/sim/store";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";

/** The one GPU-to-CPU fallback notice, shared by chat, Models and Settings (AC-09, D-06). */
export function FallbackNotice({ className }: { className?: string | undefined }) {
  const fallback = useStore((s) => s.fallbackNotice);
  const safeMode = useStore((s) => s.settings.safe_mode_cpu);
  if (!fallback || fallback.dismissed) return null;
  return (
    <Callout
      tone="caution"
      className={className}
      title="The GPU build stopped responding, so AIOS restarted the engine on the CPU build"
      action={
        <div className="flex items-center gap-2">
          {!safeMode && (
            <Button
              size="sm"
              variant="outline"
              leading={<Cpu className="size-3.5" />}
              onClick={() => {
                api.settings.update({ safe_mode_cpu: true });
                api.system.dismissFallbackNotice();
              }}
            >
              Turn on Safe mode (CPU)
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => api.system.dismissFallbackNotice()}>
            Dismiss
          </Button>
        </div>
      }
    >
      Answers are slower until AIOS restarts. If it keeps happening, turn on Safe mode (CPU). Happened{" "}
      {relativeTime(fallback.at)}.
    </Callout>
  );
}
