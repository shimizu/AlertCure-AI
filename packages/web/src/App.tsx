import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./pages/Dashboard";
import { RepoDetail } from "./pages/RepoDetail";
import { useRoute } from "./lib/router";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } },
});

export function App() {
  const route = useRoute();
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3">
            <a href="#/" className="flex items-center gap-2 font-bold">
              <span className="grid size-7 place-items-center rounded-md bg-indigo-600 text-sm text-white">AC</span>
              AlertCure AI
            </a>
            <span className="text-xs text-slate-400">Dependabot Alert 対応アシスタント</span>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">
          {route.name === "repo" ? (
            <RepoDetail key={`${route.owner}/${route.repo}`} owner={route.owner} repo={route.repo} />
          ) : (
            <Dashboard />
          )}
        </main>
      </div>
    </QueryClientProvider>
  );
}
