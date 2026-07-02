import Groq from "groq-sdk";
import { MODEL_NAME } from "../config";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Support multiple API keys — rotates to the next when one hits quota
function getApiKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GROQ_API_KEY) keys.push(process.env.GROQ_API_KEY);
  if (process.env.GROQ_API_KEY_2) keys.push(process.env.GROQ_API_KEY_2);
  if (process.env.GROQ_API_KEY_3) keys.push(process.env.GROQ_API_KEY_3);
  return keys.filter(Boolean);
}

let currentKeyIndex = 0;

function getNextClient(): Groq {
  const keys = getApiKeys();
  if (!keys.length) throw new Error("No GROQ_API_KEY set in environment");
  const key = keys[currentKeyIndex % keys.length];
  return new Groq({ apiKey: key });
}

function rotateKey() {
  const keys = getApiKeys();
  currentKeyIndex = (currentKeyIndex + 1) % Math.max(keys.length, 1);
  console.warn(`[Groq] Rotating to API key ${currentKeyIndex + 1}/${keys.length}`);
}

/**
 * Calls Groq with automatic retry and key rotation on quota errors.
 * On 429 daily quota: rotates to next key immediately.
 * On 429 rate limit: waits with backoff.
 * On 503/502/connection errors: retries with backoff.
 */
export async function generateWithRetry(prompt: string): Promise<string> {
  const maxAttempts = 6;
  let waitMs = 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = getNextClient();
      const completion = await client.chat.completions.create({
        model: MODEL_NAME,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 4096,
      });
      return completion.choices[0]?.message?.content ?? "";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      // Daily quota exhausted — rotate key immediately, no wait needed
      const isDailyQuota =
        msg.includes("tokens per day") ||
        msg.includes("TPD") ||
        (msg.includes("429") && msg.includes("day"));

      // Per-minute rate limit — wait and retry
      const isRateLimit =
        (msg.includes("429") || msg.includes("rate_limit")) && !isDailyQuota;

      // Transient errors — retry with backoff
      const isTransient =
        msg.includes("503") ||
        msg.includes("502") ||
        msg.includes("overloaded") ||
        msg.includes("fetch failed") ||
        msg.includes("Connect Timeout") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ENOTFOUND") ||
        msg.includes("Connection error");

      if (isDailyQuota) {
        console.warn(`[Groq] Daily quota exhausted on key ${currentKeyIndex + 1}. Rotating...`);
        rotateKey();
        // No wait needed — just try next key
        continue;
      }

      if ((isRateLimit || isTransient) && attempt < maxAttempts) {
        console.warn(`[Groq] Attempt ${attempt} failed. Retrying in ${waitMs / 1000}s...`);
        await delay(waitMs);
        waitMs = Math.min(waitMs * 2, 30000);
        continue;
      }

      throw err;
    }
  }

  throw new Error("Groq failed after maximum attempts across all keys");
}
