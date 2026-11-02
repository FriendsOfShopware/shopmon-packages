// Cloudflare Queues limits for sendBatch, 1 KB = 1000 bytes:
// https://developers.cloudflare.com/queues/platform/limits/
const MAX_MESSAGES_PER_BATCH = 100;
const MAX_BATCH_BYTES = 256_000;
// Messages include ~100 bytes of internal metadata that counts towards the limit.
const MESSAGE_OVERHEAD_BYTES = 100;

const encoder = new TextEncoder();

function messageBytes(message: MessageSendRequest): number {
  return encoder.encode(JSON.stringify(message.body) ?? "").byteLength + MESSAGE_OVERHEAD_BYTES;
}

/**
 * Sends messages in batches that stay within both the 100-message and the
 * 256 KB limits of a single sendBatch call. A message that exceeds the batch
 * limit on its own is sent alone and left for the queue to reject.
 */
export async function sendInBatches(queue: Queue, messages: MessageSendRequest[]): Promise<void> {
  let batch: MessageSendRequest[] = [];
  let batchBytes = 0;

  for (const message of messages) {
    const bytes = messageBytes(message);
    if (
      batch.length > 0 &&
      (batch.length >= MAX_MESSAGES_PER_BATCH || batchBytes + bytes > MAX_BATCH_BYTES)
    ) {
      await queue.sendBatch(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(message);
    batchBytes += bytes;
  }

  if (batch.length > 0) {
    await queue.sendBatch(batch);
  }
}
