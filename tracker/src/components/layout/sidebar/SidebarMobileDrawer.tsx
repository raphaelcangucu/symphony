import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMdUp } from "@/hooks/useMediaQuery";

const MOBILE_DRAWER_WIDTH_CLASS = "w-72 max-w-[288px] sm:max-w-[288px]";
const SIDEBAR_MOBILE_DRAWER_CONTENT_ID = "sidebar-mobile-drawer-content";

/**
 * Mobile shell trigger + left Sheet presenting the shared project sidebar.
 * Tree data comes from layout-level `SidebarTreeProvider` (one hook instance).
 * Drawer closes at the `md` breakpoint so desktop remains the only interactive shell.
 */
export function SidebarMobileDrawer() {
  const { t } = useTranslation();
  const location = useLocation();
  const isMdUp = useIsMdUp();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (isMdUp) {
      setOpen(false);
    }
  }, [isMdUp]);

  const openLabel = t("layout.sidebar.mobile.open");
  const drawerTitle = t("layout.sidebar.mobile.title");
  const closeLabel = t("layout.sidebar.mobile.close");

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b bg-background px-3 py-2 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground"
          aria-label={openLabel}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={SIDEBAR_MOBILE_DRAWER_CONTENT_ID}
          title={openLabel}
          onClick={() => setOpen(true)}
        >
          <PanelLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          id={SIDEBAR_MOBILE_DRAWER_CONTENT_ID}
          side="left"
          data-side="left"
          aria-modal="true"
          aria-describedby={undefined}
          closeLabel={closeLabel}
          className={`flex h-full flex-col gap-0 overflow-hidden border-r p-0 ${MOBILE_DRAWER_WIDTH_CLASS}`}
        >
          <SheetTitle className="sr-only">{drawerTitle}</SheetTitle>
          {open ? <ProjectSidebar variant="drawer" /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
