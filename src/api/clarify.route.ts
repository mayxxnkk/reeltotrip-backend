import { Router, Request, Response } from "express";
import { generateWithRetry } from "../utils/gemini";

const router = Router();

// Common words that are NOT destinations
const NON_DESTINATION_WORDS = [
  "can", "could", "would", "should", "how", "what", "why", "when", "where",
  "please", "help", "send", "try", "another", "different", "more", "wrong",
  "no", "not", "nope", "nah", "don't", "dont", "incorrect",
];

function looksLikeDestination(text: string): boolean {
  const lower = text.toLowerCase().trim();
  // If it's short (1-4 words) and doesn't contain question/negative words, treat as destination
  const words = lower.split(/\s+/);
  if (words.length > 5) return false;
  const hasNonDestWord = NON_DESTINATION_WORDS.some(w => words.includes(w));
  if (hasNonDestWord) return false;
  if (lower.includes("?")) return false;
  return true;
}

const CONFIRMATIONS = ["yes", "yeah", "yep", "yup", "sure", "correct", "right", "ok", "okay", "ya", "yea"];

router.post("/", async (req: Request, res: Response) => {
  const { message, inferredDestination } = req.body ?? {};

  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Missing message" });
    return;
  }

  const lower = message.toLowerCase().trim();

  // "yes" → confirm the inferred destination
  if (CONFIRMATIONS.includes(lower) && inferredDestination) {
    res.json({ destination: inferredDestination, reply: null });
    return;
  }

  // Looks like a plain destination name → use it directly without calling Groq
  if (looksLikeDestination(message)) {
    // Capitalize nicely
    const destination = message
      .trim()
      .split(" ")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
    res.json({ destination, reply: null });
    return;
  }

  // Ambiguous — ask Groq to interpret
  try {
    const prompt = `You are a travel chatbot. You asked the user which destination their Instagram reel is about.
The user replied: "${message}"
${inferredDestination ? `You previously guessed: "${inferredDestination}"` : ""}

Is this a destination name? If yes, extract it. If no, ask for clarification in one sentence.

Respond with ONLY valid JSON:
{"destination": "place name or null", "reply": "clarification message or null"}
- If destination found: set destination, set reply to null
- If not: set destination to null, set reply to a short question`;

    const text = await generateWithRetry(prompt);
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      res.json(parsed);
    } else {
      // Fallback — just use the message as destination
      res.json({ destination: message.trim(), reply: null });
    }
  } catch {
    // If Groq fails, treat the message as a destination directly
    res.json({ destination: message.trim(), reply: null });
  }
});

export default router;
