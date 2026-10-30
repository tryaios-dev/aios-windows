import { ArchiveRestore } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";
import { SetupFrame, StepBody, StepFooter } from "./SetupFrame";

/** Placeholder for "Restore from a backup" (MVP 9.4). Not built yet. */
export function RestoreScreen({ onBack }: { onBack: () => void }) {
  return (
    <SetupFrame eyebrow="Restore from a backup">
      <StepBody>
        <EmptyState
          display
          icon={<ArchiveRestore />}
          title="Restore is coming soon"
          description="Reopening a backup with its recovery key is not built yet in this version. Go back and set up AIOS as a new installation."
        />
      </StepBody>
      <StepFooter onBack={onBack} />
    </SetupFrame>
  );
}
