import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { Project, ProjectPatch, ProjectSort, Stats } from "@gph/shared";

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
