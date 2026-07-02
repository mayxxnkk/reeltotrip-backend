import { Router, Request, Response } from "express";
import { generateWithRetry } from "../utils/gemini";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { message, inferredDestination } = req.body ?? {};

  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Missing message" });
    return;
  }

  const context = inferredDestination
    ? `I previously guessed the destination might be "${inferredDestination}".`
    : "I could not auto-detect the destination.";

  const prompt = `You are a travel chatbot. You asked the user "Which destination is this reel about?" ${context}

The user replied: "${message}"

Determine what the user means:

1. If they clearly named a destination (city, country, or place name), extract it.
2. If they confirmed a previous guess (said "yes", "yeah", "correct", "right", "yep", "sure", "ok"), use the inferred destination: "${inferredDestination ?? "unknown"}".
3. If they said something unclear, negative ("no", "not X", "wrong"), asked a question, or didn't name a place, ask them to clarify.

Respond with ONLY valid JSON:
{
  "destination": "string or null",
  "reply": "string or null"
}

Rules:
- If you found a destination: set "destination" to the place name, set "reply" to null
- If you need clarification: set "destination" to null, set "reply" to a short friendly question (max 2 sentences)
- Never set both or neither`;

  try {
    const text = await generateWithRetry(prompt);
    // Extract JSON from response
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      res.json(parsed);
    } else {
      res.json({ destination: null, reply: "Could you tell me which destination this reel is about? (e.g. \"Rome, Italy\")" });
    }
  } catch (e) {
    res.json({ destination: null, reply: "Could you tell me which destination this reel is about?" });
  }
});

export default router;
