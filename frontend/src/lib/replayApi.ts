export interface DatasetItem {
  repo_id: string;
  last_modified: string | null;
  private: boolean;
}

export interface EpisodeItem {
  episode_index: number;
  length: number;
  tasks: string[];
  duration_seconds: number;
  duration_human: string;
}

export interface EpisodeListResponse {
  fps: number;
  total_episodes: number;
  episodes: EpisodeItem[];
}

export interface CameraItem {
  key: string;
  url: string;
}

export interface StartReplayResponse {
  success: boolean;
  message?: string;
  joint_names?: string[];
  cameras?: CameraItem[];
  fps?: number;
  num_frames?: number;
}

export interface ReplayStatus {
  active: boolean;
  repo_id: string | null;
  episode: number | null;
  frame: number;
  total_frames: number;
  fps: number;
  speed: number;
  paused: boolean;
}

type Fetcher = (url: string, options?: RequestInit) => Promise<Response>;

export async function listDatasets(baseUrl: string, fetcher: Fetcher): Promise<DatasetItem[]> {
  const r = await fetcher(`${baseUrl}/datasets`);
  if (!r.ok) throw new Error(`GET /datasets failed: ${r.status}`);
  return r.json();
}

export async function listEpisodes(baseUrl: string, fetcher: Fetcher, repoId: string): Promise<EpisodeListResponse> {
  const r = await fetcher(`${baseUrl}/episodes/${repoId}`);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `GET /episodes failed: ${r.status}`);
  }
  return r.json();
}

export async function startReplay(
  baseUrl: string,
  fetcher: Fetcher,
  repoId: string,
  episode: number
): Promise<StartReplayResponse> {
  const r = await fetcher(`${baseUrl}/replay/start`, {
    method: "POST",
    body: JSON.stringify({ repo_id: repoId, episode }),
  });
  return r.json();
}

export async function controlReplay(
  baseUrl: string,
  fetcher: Fetcher,
  action: "pause" | "resume" | "seek" | "set_speed",
  value?: number
): Promise<{ success: boolean; message?: string }> {
  const r = await fetcher(`${baseUrl}/replay/control`, {
    method: "POST",
    body: JSON.stringify({ action, value }),
  });
  return r.json();
}

export async function stopReplay(baseUrl: string, fetcher: Fetcher): Promise<{ success: boolean }> {
  const r = await fetcher(`${baseUrl}/replay/stop`, { method: "POST" });
  return r.json();
}
