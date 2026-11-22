import { createServer, type IncomingMessage, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { saveGameEvent } from "./database.js";
import { send911 } from "./logging.js";
import type { Client } from "discord.js";

const payloadSchema = z.object({
  event: z.string().trim().min(1).max(80),
  is911: z.boolean().default(false),
  details: z.string().trim().min(1).max(4000),
}).strict();

function authorized(request: IncomingMessage): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const received = Buffer.from(header.slice(7));
  const expected = Buffer.from(config.webhookSecret);
  return received.length === expected.length && timingSafeEqual(received, expected);
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

function respond(response: import("node:http").ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: body }));
}

export function createWebhookServer(client: Client): Server {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (request.method !== "POST" || request.url !== "/erlc/events") {
      respond(response, 404, "Not found.");
      return;
    }
    if (!authorized(request)) {
      respond(response, 401, "Unauthorized.");
      return;
    }

    try {
      const payload = payloadSchema.parse(await readJson(request));
      saveGameEvent(payload.event, payload.is911, payload.details);
      if (payload.is911) {
        await send911(client, "ER:LC · 911 call", `**Event:** ${payload.event}\n${payload.details}`);
      }
      response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ accepted: true }));
    } catch (error) {
      if (error instanceof RangeError || error instanceof SyntaxError || error instanceof z.ZodError) {
        respond(response, 400, error.message.slice(0, 300));
        return;
      }
      console.error("Failed to process ER:LC webhook event:", error);
      respond(response, 500, "Could not process event.");
    }
  });
}

export function startWebhook(client: Client): Server {
  const server = createWebhookServer(client);
  server.listen(config.webhookPort, "0.0.0.0");
  return server;
}

