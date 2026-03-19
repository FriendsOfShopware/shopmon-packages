import { Hono } from "hono";
import { enqueueSyncForAllTokens, processSyncToken, type QueueMessage } from "./sync";
import { processDownload } from "./download";
import { getPackagesJson, getPackageMetadata, downloadPackage } from "./routes/packages";
import { createToken, listTokens, deleteToken, syncToken } from "./routes/tokens";
import { authMiddleware } from "./middleware/auth";
import { adminAuthMiddleware } from "./middleware/admin-auth";
import { cacheMiddleware } from "./middleware/cache";
import { purgeByCacheTags } from "./cache";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/packages.json", cacheMiddleware, authMiddleware, getPackagesJson);
app.get("/p2/*", cacheMiddleware, authMiddleware, getPackageMetadata);
app.get("/download/*", cacheMiddleware, authMiddleware, downloadPackage);

app.use("/api/*", adminAuthMiddleware);
app.post("/api/tokens", createToken);
app.get("/api/tokens", listTokens);
app.delete("/api/tokens/:id", deleteToken);
app.post("/api/tokens/:id/sync", syncToken);

app.get("/api/sync", async (c) => {
  await enqueueSyncForAllTokens(c.env);
  return c.text("Sync enqueued for all tokens");
});

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, env: CloudflareBindings, ctx: ExecutionContext) {
    ctx.waitUntil(enqueueSyncForAllTokens(env));
  },

  async queue(batch: MessageBatch<QueueMessage>, env: CloudflareBindings) {
    const packagesToPurge = new Set<string>();

    for (const message of batch.messages) {
      try {
        switch (message.body.type) {
          case "sync-token":
            await processSyncToken(message.body.tokenId, env);
            break;
          case "download-package":
            await processDownload(message.body, env);
            break;
          case "purge-package-cache":
            packagesToPurge.add(message.body.name);
            break;
        }
        message.ack();
      } catch (error) {
        console.error(
          `Error processing message:`,
          error instanceof Error ? error.message : error,
          error instanceof Error ? error.stack : "",
        );
        message.retry();
      }
    }

    if (packagesToPurge.size > 0) {
      const tags = [...packagesToPurge].map((name) => `p-${name}`);
      await purgeByCacheTags(tags, env);
    }
  },
};
