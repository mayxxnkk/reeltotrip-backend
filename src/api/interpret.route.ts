import { Router, Request, Response } from "express";
import { fetchReelCaptionSafe } from "../utils/fetchReelCaption";
import { generateWithRetry } from "../utils/gemini";
import { extractJsonSafely } from "../utils/extractJson";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const reelUrl = req.body?.reelUrl;
  const conversationHint: string = req.body?.conversationHint ?? "";

  if (typeof reelUrl !== "string" || !reelUrl.trim()) {
    res.status(400).json({ error: "Missing or invalid reelUrl" });
    return;
  }

  try {
    const caption = await fetchReelCaptionSafe(reelUrl.trim());

    const hintSection = conversationHint.trim()
      ? `\nConversation context (what the user has said so far): "${conversationHint.slice(0, 300)}"\nUse this context to improve your guess.`
      : "";

    const prompt = `You are a travel destination detection agent.

Your task: identify the travel destination shown in an Instagram reel.

Reel URL: ${reelUrl}
Caption: ${caption ?? "(not available)"}
${hintSection}

Instructions:
- If the caption clearly mentions a destination, use it.
- If no caption, use any context clues available.
- If the conversation context mentions a destination (e.g. user said "its about italy"), use that.
- Set confidence to "high" if certain, "medium" if reasonably sure, "low" if guessing.
- NEVER return null. If completely unknown, return "Unknown Destination" with confidence "low".

Respond with ONLY valid JSON:
{
  "destination": string,
  "country": string,
  "vibe": string[],
  "key_activities": string[],
  "confidence": "low" | "medium" | "high"
}`;

    const text = await generateWithRetry(prompt);
    const result = extractJsonSafely(text) as {
      destination?: string;
      country?: string;
      vibe?: string[];
      key_activities?: string[];
      confidence?: string;
    };

    res.json({
      destination: result.destination ?? "Unknown Destination",
      country: result.country ?? "Unknown",
      vibe: result.vibe ?? [],
      key_activities: result.key_activities ?? [],
      confidence: result.confidence ?? "low",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Interpretation failed" });
  }
});

export default router;
