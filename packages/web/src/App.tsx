import { useEffect, useState } from "react";

type Health = "loading" | "ok" | "error";

export function App() {
  const [health, setHealth] = useState<Health>("loading");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(() => setHealth("ok"))
      .catch(() => setHealth("error"));
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <h1 className="text-2xl font-bold">AlertCure AI</h1>
      <p className="mt-2 text-sm text-slate-600">
        サーバー接続: <span data-testid="health">{health}</span>
      </p>
    </main>
  );
}
