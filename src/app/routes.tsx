import { createBrowserRouter, Outlet } from "react-router-dom";
import { lazy, Suspense } from "react";

import { AppFrame } from "./AppFrame";

const HomePage = lazy(() => import("../features/home/HomePage").then((module) => ({ default: module.HomePage })));
const QueryPage = lazy(() => import("../features/translation/QueryPage").then((module) => ({ default: module.QueryPage })));
const ReadingHomePage = lazy(() => import("@/features/reading/ReadingHomePage").then((module) => ({ default: module.ReadingHomePage })));
const ReadingArticlePage = lazy(() => import("@/features/reading/ReadingArticlePage").then((module) => ({ default: module.ReadingArticlePage })));
const VocabularyPage = lazy(() => import("@/features/vocabulary/VocabularyPage").then((module) => ({ default: module.VocabularyPage })));
const StudyPage = lazy(() => import("@/features/study/StudyPage").then((module) => ({ default: module.StudyPage })));
const SettingsPage = lazy(() => import("../features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const QueryHistoryPage = lazy(() => import("../features/history/QueryHistoryPage").then((module) => ({ default: module.QueryHistoryPage })));

function FrameRoute() {
  return (
    <AppFrame>
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </AppFrame>
  );
}

export const appRoutes = [
  {
    element: <FrameRoute />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/query", element: <QueryPage /> },
      { path: "/reading", element: <ReadingHomePage /> },
      { path: "/reading/article", element: <ReadingArticlePage /> },
      { path: "/vocabulary", element: <VocabularyPage /> },
      { path: "/study", element: <StudyPage /> },
      { path: "/records", element: <QueryHistoryPage /> },
      { path: "/settings", element: <SettingsPage /> },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
