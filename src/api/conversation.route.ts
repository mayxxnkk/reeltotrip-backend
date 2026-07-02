import { Router, Request, Response } from "express";
import { runPipeline } from "../orchestrator/orchestrator";
import { generateWithRetry } from "../utils/gemini";
import {
  getConversation,
  appendTurn,
  buildHistoryText,
  updateConversationCurrency,
} from "../memory/conversationState";

const router = Router();

async function getSimpleReply(message: string, historyText: string): Promise<string> {
  const prompt = `You are a friendly travel planning chatbot assistant.

Conversation so far:
${historyText}

User just said: "${message}"

Reply helpfully in 1-3 sentences. Be conversational and friendly.
- If they want to send a new reel, tell them to go ahead and paste the Instagram reel link.
- If they're asking a simple question about the trip, answer it briefly.
- Do NOT re-plan the trip or generate a new itinerary.`;
  return generateWithRetry(prompt);
}

function needsReplan(message: string): boolean {
  const lower = message.toLowerCase();
  const replanKeywords = [
    "cheaper", "expensive", "budget", "luxury", "add day", "more day",
    "fewer day", "less day", "extend", "shorten", "focus on", "instead of",
    "change the", "update the", "different hotel", "different activity",
    "make it", "redo", "replanning", "replan",
  ];
  return replanKeywords.some((kw) => lower.includes(kw));
}

router.post("/", async (req: Request, res: Response) => {
  const { conversationId, message } = req.body ?? {};
  const currency: string =
    typeof req.body?.currency === "string" ? req.body.currency : "USD";

  if (typeof conversationId !== "string" || !conversationId.trim()) {
    res.status(400).json({ error: "Missing or invalid conversationId" });
    return;
  }

  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Missing or invalid message" });
    return;
  }

  const state = getConversation(conversationId.trim());
  if (!state) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  updateConversationCurrency(state.id, currency);
  appendTurn(state.id, "user", message.trim());

  try {
    if (needsReplan(message)) {
      // Full pipeline re-run — pass stored destination to avoid re-guessing
      const historyText = buildHistoryText(state);
      const result = await runPipeline(state.reelUrl, state.currency, historyText, state.destination);
      appendTurn(state.id, "agent", result.summary);
      res.json({
        conversationId: state.id,
        summary: result.summary,
        history: buildHistoryText(state),
      });
    } else {
      // Simple conversational reply — one Groq call, no pipeline
      const historyText = buildHistoryText(state);
      const reply = await getSimpleReply(message.trim(), historyText);
      appendTurn(state.id, "agent", reply);
      res.json({
        conversationId: state.id,
        summary: reply,
        history: buildHistoryText(state),
      });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Conversation pipeline failed",
    });
  }
});

export default router;

