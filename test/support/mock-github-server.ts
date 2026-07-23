import { createServer, type IncomingHttpHeaders } from "node:http";

/** One deterministic response served by the local GitHub API mock. */
export interface MockGitHubFixture {
  /** HTTP method matched case-insensitively. */
  readonly method: string;
  /** Request pathname matched by this fixture. */
  readonly pathname: string;
  /** HTTP status emitted by the mock. */
  readonly status: number;
  /** JSON response payload emitted by the mock. */
  readonly body: unknown;
}

/** One HTTP request received by the local GitHub API mock. */
export interface MockGitHubRequest {
  /** HTTP method sent by the test subject. */
  readonly method: string;
  /** Request pathname sent by the test subject. */
  readonly pathname: string;
  /** Request headers recorded without contacting GitHub. */
  readonly headers: IncomingHttpHeaders;
}

/** A localhost-only GitHub API mock and its recorded requests. */
export interface MockGitHubServer {
  /** Base URL on an ephemeral localhost port. */
  readonly baseUrl: string;
  /** Requests received before the server was closed. */
  readonly requests: readonly MockGitHubRequest[];
  /** Whether the server has completed its shutdown. */
  readonly isClosed: boolean;
  /** Stops the local server and releases its ephemeral port. */
  close(): Promise<void>;
}

/**
 * Starts a localhost-only HTTP server that returns the supplied GitHub fixtures.
 *
 * @param fixtures Deterministic API responses available to the test.
 * @returns A mock server that must be closed by its caller.
 */
export async function createMockGitHubServer(
  fixtures: readonly MockGitHubFixture[]
): Promise<MockGitHubServer> {
  const requests: MockGitHubRequest[] = [];
  let isClosed = false;
  const server = createServer((request, response) => {
    const method = request.method ?? "GET";
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    requests.push({ headers: request.headers, method, pathname });
    const fixture = fixtures.find(
      candidate =>
        candidate.method.toUpperCase() === method.toUpperCase() &&
        candidate.pathname === pathname
    );

    if (fixture === undefined) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "fixture not found" }));
      return;
    }

    response.writeHead(fixture.status, { "content-type": "application/json" });
    response.end(JSON.stringify(fixture.body));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw new Error("Mock GitHub server did not receive a TCP address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    get isClosed(): boolean {
      return isClosed;
    },
    async close(): Promise<void> {
      if (isClosed) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        server.close(error => (error === undefined ? resolve() : reject(error)));
      });
      isClosed = true;
    }
  };
}
