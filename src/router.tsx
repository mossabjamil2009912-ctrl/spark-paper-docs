import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    basepath: import.meta.env.BASE_URL.replace(/\/$/, "") || "/",
    // GitHub Pages serves each page as folder/index.html and adds a trailing slash; accept both forms there.
    ...(import.meta.env.BASE_URL !== "/" ? { trailingSlash: "preserve" as const } : {}),
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
