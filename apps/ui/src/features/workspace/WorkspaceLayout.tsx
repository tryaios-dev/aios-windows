import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { motion } from "motion/react";
import { BP, useMediaQuery } from "@/lib/useMediaQuery";
import { EASE } from "@/lib/motion";
import { Sidebar } from "./Sidebar";
import { useWorkspaceStore } from "./store";

/** The application frame: sidebar on the left, the active view on the right. */
export function WorkspaceLayout() {
  const location = useLocation();
  const collapsed = useWorkspaceStore((s) => s.sidebarCollapsed);
  const setCollapsed = useWorkspaceStore((s) => s.setSidebarCollapsed);
  const rail = useMediaQuery(BP.rail);

  // Ctrl+\ toggles the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setCollapsed(!collapsed);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, setCollapsed]);

  // Animate between top-level areas only; moving inside a project should not re-animate the frame.
  const viewKey = location.pathname.split("/").slice(0, 3).join("/");

  return (
    <div className="flex h-full w-full bg-paper text-ink">
      <Sidebar
        mode={rail || collapsed ? "rail" : "full"}
        onCollapse={rail ? undefined : () => setCollapsed(true)}
        onExpand={rail ? undefined : () => setCollapsed(false)}
      />
      <main className="relative flex min-w-0 flex-1 flex-col">
        {location.pathname === "/" ? (
          // The index route only redirects; keep it out of the animation so the target mounts cleanly.
          <Outlet />
        ) : (
          <motion.div key={viewKey} className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0.4, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: EASE }}>
            <Outlet />
          </motion.div>
        )}
      </main>
    </div>
  );
}
