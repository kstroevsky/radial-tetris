export class LeaderboardApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "LeaderboardApiError";
    this.status = status;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      accept: "application/json",
      ...options.headers,
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  let data = null;
  if (contentType.includes("application/json")) {
    data = await response.json();
  }

  if (!response.ok) {
    throw new LeaderboardApiError(data?.error ?? "Leaderboard request failed", response.status);
  }
  if (!data) throw new LeaderboardApiError("Leaderboard returned an invalid response", response.status);
  return data;
}

let profileRequest = null;

function unavailableInViteDev() {
  return import.meta.env?.DEV
    ? new LeaderboardApiError("Leaderboard API is available through Cloudflare Pages dev or production")
    : null;
}

export function getProfile() {
  const unavailable = unavailableInViteDev();
  if (unavailable) return Promise.reject(unavailable);
  if (!profileRequest) {
    profileRequest = request("/api/profile", { cache: "no-store" }).catch((error) => {
      profileRequest = null;
      throw error;
    });
  }
  return profileRequest;
}

export async function saveProfile(name) {
  const unavailable = unavailableInViteDev();
  if (unavailable) throw unavailable;
  const data = await request("/api/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  profileRequest = Promise.resolve(data);
  return data;
}

export function submitGameResult(result) {
  const unavailable = unavailableInViteDev();
  if (unavailable) return Promise.reject(unavailable);
  return request("/api/results", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
    keepalive: true,
  });
}

export function getLeaderboard(sort, signal) {
  const unavailable = unavailableInViteDev();
  if (unavailable) return Promise.reject(unavailable);
  return request(`/api/leaderboard?sort=${encodeURIComponent(sort)}`, {
    cache: "no-store",
    signal,
  });
}
