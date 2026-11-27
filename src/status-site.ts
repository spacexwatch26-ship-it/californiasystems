import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { database } from "./database.js";

const SESSION_COOKIE = "csrp_status_admin";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_LOGIN_IPS = 1000;

const statusSchema = z.enum(["operational", "degraded", "maintenance", "offline"]);
const categorySchema = z.enum(["development", "maintenance", "release"]);
const loginSchema = z.object({ password: z.string().min(1).max(500) }).strict();
const statusUpdateSchema = z.object({
  status: statusSchema,
  message: z.string().trim().max(500),
}).strict();
const developmentUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(4000),
  category: categorySchema,
}).strict();

type WebsiteStatus = {
  status: z.infer<typeof statusSchema>;
  message: string;
  updated_at: string;
};
type DevelopmentUpdate = {
  id: number;
  title: string;
  content: string;
  category: z.infer<typeof categorySchema>;
  created_at: string;
  updated_at: string;
};

const siteFiles = new Map<string, { file: string; contentType: string }>([
  ["/", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/admin", { file: "admin.html", contentType: "text/html; charset=utf-8" }],
  ["/admin/", { file: "admin.html", contentType: "text/html; charset=utf-8" }],
  ["/site.css", { file: "site.css", contentType: "text/css; charset=utf-8" }],
  ["/site.js", { file: "site.js", contentType: "text/javascript; charset=utf-8" }],
  ["/admin.js", { file: "admin.js", contentType: "text/javascript; charset=utf-8" }],
]);

const activeSessions = new Map<string, number>();
const loginFailures = new Map<string, { count: number; resetAt: number }>();
const configuredPasswordDigest = config.statusDashboardPassword
  ? createHash("sha256").update(config.statusDashboardPassword).digest()
  : undefined;

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'",
};

function respondJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    ...securityHeaders,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function requestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://localhost").pathname;
}

function isJsonRequest(request: IncomingMessage): boolean {
  return request.headers["content-type"]?.split(";")[0].trim().toLowerCase() === "application/json";
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += data.length;
    if (bytes > 16_384) throw new RangeError("Request body exceeds 16 KB.");
    chunks.push(data);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function badRequestMessage(error: unknown): string {
  if (error instanceof RangeError) return error.message;
  if (error instanceof SyntaxError) return "Request body must be valid JSON.";
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ").slice(0, 300);
  }
  return "Invalid request.";
}

function getClientAddress(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? "unknown";
}

function cleanExpiredLoginFailures(now: number): void {
  for (const [address, failure] of loginFailures) {
    if (failure.resetAt <= now) loginFailures.delete(address);
  }
}

function loginFailureFor(address: string, now: number): { count: number; resetAt: number } | undefined {
  const failure = loginFailures.get(address);
  if (failure && failure.resetAt <= now) {
    loginFailures.delete(address);
    return undefined;
  }
  return failure;
}

function loginIsLimited(address: string, now: number): boolean {
  return (loginFailureFor(address, now)?.count ?? 0) >= MAX_LOGIN_ATTEMPTS;
}

function recordLoginFailure(address: string, now: number): void {
  cleanExpiredLoginFailures(now);
  const current = loginFailureFor(address, now);
  if (!current && loginFailures.size >= MAX_LOGIN_IPS) return;
  loginFailures.set(address, current
    ? { count: current.count + 1, resetAt: current.resetAt }
    : { count: 1, resetAt: now + LOGIN_WINDOW_MS });
}

function passwordMatches(password: string): boolean {
  if (!configuredPasswordDigest) return false;
  const submittedDigest = createHash("sha256").update(password).digest();
  return timingSafeEqual(submittedDigest, configuredPasswordDigest);
}

function cookieValue(request: IncomingMessage): string | undefined {
  const prefix = `${SESSION_COOKIE}=`;
  return request.headers.cookie
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}

function pruneSessions(now: number): void {
  for (const [token, expiresAt] of activeSessions) {
    if (expiresAt <= now) activeSessions.delete(token);
  }
}

function isAuthenticated(request: IncomingMessage): boolean {
  const token = cookieValue(request);
  if (!token) return false;
  const expiresAt = activeSessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

function secureCookie(request: IncomingMessage): boolean {
  return request.headers["x-forwarded-proto"]
    ?.split(",")[0]
    .trim()
    .toLowerCase() === "https";
}

function cookieHeader(request: IncomingMessage, token: string, maxAge: number): string {
  const secure = secureCookie(request) ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function getWebsiteStatus(): WebsiteStatus {
  const status = database.prepare(`
    SELECT status, message, updated_at FROM website_status WHERE singleton = 1
  `).get() as WebsiteStatus | undefined;
  if (!status) throw new Error("The website status record is missing.");
  return status;
}

function getDevelopmentUpdates(): DevelopmentUpdate[] {
  return database.prepare(`
    SELECT id, title, content, category, created_at, updated_at
    FROM development_updates
    ORDER BY id DESC
    LIMIT 50
  `).all() as DevelopmentUpdate[];
}

function requireAuthentication(request: IncomingMessage, response: ServerResponse): boolean {
  if (isAuthenticated(request)) return true;
  respondJson(response, 401, { error: "Please sign in to edit the status website." });
  return false;
}

async function serveStaticFile(
  response: ServerResponse,
  file: string,
  contentType: string,
): Promise<void> {
  const body = await readFile(resolve(process.cwd(), "public", file));
  response.writeHead(200, {
    ...securityHeaders,
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  response.end(body);
}

export async function handleStatusSiteRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const path = requestPath(request);
  const staticFile = siteFiles.get(path);
  if (request.method === "GET" && staticFile) {
    await serveStaticFile(response, staticFile.file, staticFile.contentType);
    return true;
  }

  if (request.method === "GET" && path === "/api/status") {
    respondJson(response, 200, { status: getWebsiteStatus(), updates: getDevelopmentUpdates() });
    return true;
  }

  if (request.method === "GET" && path === "/api/admin/session") {
    respondJson(response, 200, { authenticated: isAuthenticated(request) });
    return true;
  }

  if (request.method === "POST" && path === "/api/admin/login") {
    if (!config.statusDashboardPassword) {
      respondJson(response, 503, { error: "The dashboard password has not been configured." });
      return true;
    }

    const address = getClientAddress(request);
    const now = Date.now();
    if (loginIsLimited(address, now)) {
      const failure = loginFailureFor(address, now);
      const seconds = Math.max(1, Math.ceil(((failure?.resetAt ?? now) - now) / 1000));
      respondJson(response, 429, { error: "Too many sign-in attempts. Try again later." }, {
        "Retry-After": String(seconds),
      });
      return true;
    }
    if (!isJsonRequest(request)) {
      respondJson(response, 415, { error: "Send the sign-in form as JSON." });
      return true;
    }

    try {
      const credentials = loginSchema.parse(await readJson(request));
      if (!passwordMatches(credentials.password)) {
        recordLoginFailure(address, now);
        respondJson(response, 401, { error: "The password was not accepted." });
        return true;
      }

      loginFailures.delete(address);
      pruneSessions(now);
      if (activeSessions.size >= 50) {
        respondJson(response, 503, { error: "The editor is temporarily at its session limit." });
        return true;
      }
      const token = randomBytes(32).toString("base64url");
      activeSessions.set(token, now + SESSION_DURATION_MS);
      respondJson(response, 200, { authenticated: true }, {
        "Set-Cookie": cookieHeader(request, token, SESSION_DURATION_MS / 1000),
      });
    } catch (error) {
      if (error instanceof RangeError || error instanceof SyntaxError || error instanceof z.ZodError) {
        respondJson(response, 400, { error: badRequestMessage(error) });
        return true;
      }
      throw error;
    }
    return true;
  }

  if (request.method === "POST" && path === "/api/admin/logout") {
    const token = cookieValue(request);
    if (token) activeSessions.delete(token);
    respondJson(response, 200, { authenticated: false }, {
      "Set-Cookie": cookieHeader(request, "", 0),
    });
    return true;
  }

  if (request.method === "PUT" && path === "/api/admin/status") {
    if (!requireAuthentication(request, response)) return true;
    if (!isJsonRequest(request)) {
      respondJson(response, 415, { error: "Send the status as JSON." });
      return true;
    }
    try {
      const input = statusUpdateSchema.parse(await readJson(request));
      database.prepare(`
        UPDATE website_status SET status = ?, message = ?, updated_at = datetime('now')
        WHERE singleton = 1
      `).run(input.status, input.message);
      respondJson(response, 200, { status: getWebsiteStatus() });
    } catch (error) {
      if (error instanceof RangeError || error instanceof SyntaxError || error instanceof z.ZodError) {
        respondJson(response, 400, { error: badRequestMessage(error) });
        return true;
      }
      throw error;
    }
    return true;
  }

  const updateMatch = path.match(/^\/api\/admin\/updates\/([1-9]\d*)$/);
  if (updateMatch && (request.method === "PUT" || request.method === "DELETE")) {
    if (!requireAuthentication(request, response)) return true;
    const updateId = Number(updateMatch[1]);
    if (!Number.isSafeInteger(updateId)) {
      respondJson(response, 400, { error: "Invalid update ID." });
      return true;
    }

    if (request.method === "DELETE") {
      const result = database.prepare("DELETE FROM development_updates WHERE id = ?").run(updateId);
      if (Number(result.changes) === 0) {
        respondJson(response, 404, { error: "That development update was not found." });
        return true;
      }
      respondJson(response, 200, { deleted: true });
      return true;
    }

    if (!isJsonRequest(request)) {
      respondJson(response, 415, { error: "Send the development update as JSON." });
      return true;
    }
    try {
      const input = developmentUpdateSchema.parse(await readJson(request));
      const result = database.prepare(`
        UPDATE development_updates
        SET title = ?, content = ?, category = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(input.title, input.content, input.category, updateId);
      if (Number(result.changes) === 0) {
        respondJson(response, 404, { error: "That development update was not found." });
        return true;
      }
      const update = database.prepare(`
        SELECT id, title, content, category, created_at, updated_at
        FROM development_updates WHERE id = ?
      `).get(updateId) as DevelopmentUpdate | undefined;
      if (!update) throw new Error(`Development update ${updateId} disappeared after it was saved.`);
      respondJson(response, 200, { update });
    } catch (error) {
      if (error instanceof RangeError || error instanceof SyntaxError || error instanceof z.ZodError) {
        respondJson(response, 400, { error: badRequestMessage(error) });
        return true;
      }
      throw error;
    }
    return true;
  }

  if (request.method === "POST" && path === "/api/admin/updates") {
    if (!requireAuthentication(request, response)) return true;
    if (!isJsonRequest(request)) {
      respondJson(response, 415, { error: "Send the development update as JSON." });
      return true;
    }
    try {
      const input = developmentUpdateSchema.parse(await readJson(request));
      const result = database.prepare(`
        INSERT INTO development_updates (title, content, category) VALUES (?, ?, ?)
      `).run(input.title, input.content, input.category);
      const update = database.prepare(`
        SELECT id, title, content, category, created_at, updated_at
        FROM development_updates WHERE id = ?
      `).get(Number(result.lastInsertRowid)) as DevelopmentUpdate | undefined;
      if (!update) throw new Error("The development update could not be loaded after it was saved.");
      respondJson(response, 201, { update });
    } catch (error) {
      if (error instanceof RangeError || error instanceof SyntaxError || error instanceof z.ZodError) {
        respondJson(response, 400, { error: badRequestMessage(error) });
        return true;
      }
      throw error;
    }
    return true;
  }

  return false;
}
