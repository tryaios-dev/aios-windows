/** Typed HTTP client from Electron main to the local API. Only main holds the token. */
export class BackendClient {
  readonly #base: string;
  readonly #token: string;

  constructor(port: number, token: string) {
    this.#base = `http://127.0.0.1:${port}`;
    this.#token = token;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.#base + path, {
      method,
      headers: { Authorization: `Bearer ${this.#token}`, "Content-Type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`backend_${res.status}`);
    return (await res.json()) as T;
  }
}
