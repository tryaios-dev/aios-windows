/** Typed HTTP client from Electron main to the local API. Only main holds the token. */
export class BackendClient {
  readonly #base: string;
  readonly #token: string;

  constructor(port: number, token: string) {
    this.#base = `http://127.0.0.1:${port}`;
    this.#token = token;
  }

  /** Throws `Error(code)`: the backend's `{"error": code}`, else `backend_<status>`. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.#base + path, {
      method,
      headers: { Authorization: `Bearer ${this.#token}`, "Content-Type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await errorCode(res));
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

async function errorCode(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      if (/^[a-z][a-z0-9_]*$/.test(body.error)) return body.error;
    }
  } catch {
    /* not JSON */
  }
  return res.status === 422 ? "invalid_request" : `backend_${res.status}`;
}
