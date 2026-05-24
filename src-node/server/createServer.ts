import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { Bot } from "grammy";
import type { Update } from "@grammyjs/types";
import type { AppConfig } from "../config.js";
import type { AppLogger } from "../logger.js";

type CreateServerOptions = {
  bot: Bot;
  config: AppConfig;
  logger: AppLogger;
};

export function createServer({ bot, config, logger }: CreateServerOptions) {
  const server = Fastify({ logger: false });
  const requestStarts = new WeakMap<FastifyRequest, number>();

  server.addHook("onRequest", (request, _reply, done) => {
    requestStarts.set(request, Date.now());
    done();
  });

  server.addHook("onResponse", (request, reply, done) => {
    logger.info(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs: Date.now() - (requestStarts.get(request) ?? Date.now())
      },
      "http_request"
    );
    done();
  });

  server.get("/healthz", async () => ({
    ok: true
  }));

  server.post("/telegram/webhook", async (request: FastifyRequest<{ Body: Update }>, reply: FastifyReply) => {
    if (config.WEBHOOK_SECRET) {
      const header = request.headers["x-telegram-bot-api-secret-token"];
      if (header !== config.WEBHOOK_SECRET) {
        return reply.code(401).send({ ok: false });
      }
    }

    await bot.handleUpdate(request.body);
    return reply.code(200).send({ ok: true });
  });

  return server;
}
