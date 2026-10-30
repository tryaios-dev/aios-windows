import type * as React from "react";
import { Construction } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

/** Stand-in for a screen whose feature folder does not exist yet. */
export function ComingSoon({ title, description, icon = <Construction /> }: { title: string; description?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper">
      <EmptyState display icon={icon} title={title} description={description ?? "This screen is not built yet."} className="flex-1" />
    </div>
  );
}
