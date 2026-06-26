import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  NotificationConfig,
  Project,
  ProjectPatch,
  ProjectSort,
  Stats,
} from "@gph/shared";

const TOKEN_KEY = "gph_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}
export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t.trim());
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getToken()}`,
      ...init.headers,
    },
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export interface ProjectDetail extends Project {
  activity: { day: string; turns: number }[];
  recent_summary: string | null;
}

export function useProjects(sort: ProjectSort, includeArchived: boolean) {
  return useQuery({
    queryKey: ["projects", sort, includeArchived],
    queryFn: () =>
      api<Project[]>(
        `/projects?sort=${sort}&archived=${includeArchived}`,
      ),
    refetchInterval: 15_000,
  });
}

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => api<Stats>("/stats"),
    refetchInterval: 15_000,
  });
}

export function useProjectDetail(id: number | null) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => api<ProjectDetail>(`/projects/${id}`),
    enabled: id != null,
  });
}

/** Generate (or refresh) the AI memory-aid summary for a project. */
export function useSummarize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/v1/projects/${id}/summarize`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${getToken()}`,
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.hint || body.detail || body.error || `HTTP ${res.status}`);
      }
      return body as Project;
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function usePatchProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ProjectPatch }) =>
      api<Project>(`/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

/* ── Notifications ─────────────────────────────────────────── */

export function useNotificationConfig() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<NotificationConfig | null>("/notifications"),
  });
}

export function useSaveNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { webhook_url: string; enabled: boolean }) =>
      api<NotificationConfig>("/notifications", {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/notifications", { method: "DELETE" }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

/** Send a digest now (to the entered URL, before saving). Throws with detail. */
export function useTestNotification() {
  return useMutation({
    mutationFn: async (webhook_url: string) => {
      const res = await fetch("/api/v1/notifications/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ webhook_url }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.hint || body.detail || body.error || `HTTP ${res.status}`);
      }
      return body as { ok: true };
    },
  });
}
