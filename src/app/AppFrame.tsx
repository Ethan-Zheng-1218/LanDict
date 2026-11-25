import type { PropsWithChildren } from "react";
import { useEffect, useLayoutEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getReadingPosition, getResumeScrollTop, saveReadingPosition } from "@/features/reading/readingResume";
import {
  BookOpen,
  Languages,
  Home,
  Settings,
  StickyNote,
  Graduate,
} from "@/components/ui/icon";

import { BrandLogo } from "@/components/ui/brand-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { loadSettings, SETTINGS_CHANGED_EVENT, SETTINGS_STORAGE_KEY } from "@/features/settings/settingsStore";

export const APP_NAV_ITEMS = [
  { label: "首页", to: "/", icon: Home },
  { label: "翻译", to: "/query", icon: Languages },
  { label: "阅读", to: "/reading", icon: BookOpen },
  { label: "生词本", to: "/vocabulary", icon: StickyNote },
  { label: "背单词", to: "/study", icon: Graduate },
] as const;

function isNavItemActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/" || pathname === "/records";
  if (to === "/query") return pathname === "/query";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function AppFrame({ children }: PropsWithChildren) {
  const location = useLocation();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useLayoutEffect(() => {
    const applyTheme = () => { document.documentElement.dataset.theme = loadSettings().appearance.theme; };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SETTINGS_STORAGE_KEY || event.key === null) applyTheme();
    };
    applyTheme();
    window.addEventListener(SETTINGS_CHANGED_EVENT, applyTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, applyTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (location.pathname !== "/reading" && location.pathname !== "/reading/article") return;
    const position = {
      pathname: location.pathname as "/reading" | "/reading/article",
      search: location.search,
      state: location.state as Record<string, unknown> | null,
      scrollTop: getResumeScrollTop(location.state) ?? 0,
    };
    const trackScroll = (event: Event) => {
      const element = event.target;
      if (element instanceof HTMLElement && element.matches(".reading-home-page, .reading-article-scroll")) position.scrollTop = element.scrollTop;
    };
    const save = () => saveReadingPosition(position);
    document.addEventListener("scroll", trackScroll, true);
    window.addEventListener("pagehide", save);
    return () => {
      save();
      document.removeEventListener("scroll", trackScroll, true);
      window.removeEventListener("pagehide", save);
    };
  }, [location]);

  return (
    <div className={location.pathname === "/" ? "app-frame app-frame-home" : "app-frame"}>
      <SidebarProvider
        className="app-sidebar-provider"
      >
        <Sidebar className="app-sidebar" collapsible="none">
          <SidebarHeader className="app-sidebar-header">
            <div className="brand">
              <BrandLogo />
              <div>
                <div className="brand-name">LanDict</div>
                <div className="brand-tagline">Less is more</div>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent className="app-sidebar-content">
            <nav aria-label="主导航">
              <SidebarGroup className="app-sidebar-group">
                <SidebarGroupContent>
                  <SidebarMenu>
                    {APP_NAV_ITEMS.map(({ icon: Icon, label, to }) => {
                      const active = isNavItemActive(location.pathname, to);
                      return (
                        <SidebarMenuItem key={to}>
                          <SidebarMenuButton
                            className="nav-item"
                            isActive={active}
                            render={<Link aria-label={label} aria-current={active ? "page" : undefined} to={to} onClick={to === "/reading" ? (event) => {
                              event.preventDefault();
                              if (location.pathname.startsWith("/reading")) return;
                              const position = getReadingPosition();
                              navigate({ pathname: position.pathname, search: position.search }, {
                                state: { ...position.state, ...(position.scrollTop !== undefined ? { readingScrollTop: position.scrollTop } : {}) },
                              });
                            } : undefined} />}
                          >
                            <Icon aria-hidden="true" />
                            <span>{label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </nav>
            <aside
              aria-label="阅读文章目录"
              className="reading-outline-sidebar-slot"
              id="reading-outline-sidebar-slot"
            />
          </SidebarContent>

          <SidebarFooter className="sidebar-settings" data-testid="sidebar-settings">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="settings-link"
                  isActive={settingsOpen || location.pathname === "/settings"}
                  render={<Link aria-label="设置" onClick={(event) => { event.preventDefault(); setSettingsOpen(true); }} to="/settings" />}
                >
                  <Settings aria-hidden="true" />
                  <span>设置</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
      </SidebarProvider>

      <div className="app-workspace">
        <main
          className={location.pathname.startsWith("/reading") || location.pathname === "/vocabulary"
            ? "app-content app-content-prototype"
            : location.pathname === "/query" ? "app-content app-content-feature" : "app-content"}
          data-scroll-container="app-content"
        >
          {children}
        </main>
      </div>
      {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
