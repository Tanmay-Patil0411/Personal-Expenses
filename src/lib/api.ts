// Client-side API helpers (browser fetch wrappers).

function handleUnauthorized(res: Response) {
  if (
    res.status === 401 &&
    typeof window !== "undefined" &&
    !window.location.pathname.startsWith("/login") &&
    !window.location.pathname.startsWith("/register") &&
    !window.location.pathname.startsWith("/forgot-password")
  ) {
    const redirect = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    window.location.href = `/login?redirect=${redirect}`;
  }
}

export async function apiGet<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    handleUnauthorized(res);
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function apiPost<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function apiPut<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function apiPatch<T = any>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function apiDelete<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleUnauthorized(res);
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}
