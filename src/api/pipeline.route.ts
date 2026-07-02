import { Router, Request, Response } from "express";
import { runPipeline } from "../orchestrator/orchestrator";
import {
  createConversation,
  buildHistoryText,
} from "../memory/conversationState";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const reelUrl = req.body?.reelUrl;
  const currency: string =
    typeof req.body?.currency === "string" ? req.body.currency : "USD";
  const destinationOverride: string | undefined =
    typeof req.body?.destination === "string" && req.body.destination.trim()
      ? req.body.destination.trim()
      : undefined;

  if (typeof reelUrl !== "string" || !reelUrl.trim()) {
    res.status(400).json({ error: "Missing or invalid reelUrl" });
    return;
  }

  try {
    const result = await runPipeline(reelUrl.trim(), currency, undefined, destinationOverride);

    const initialUserMessage = `New reel: ${reelUrl.trim()}`;
    const initialAgentMessage = result.summary;
    const state = createConversation(
      reelUrl.trim(),
      currency,
      initialUserMessage,
      initialAgentMessage,
      result.reelInterpretation.destination  // save destination for re-plans
    );

    const historyText = buildHistoryText(state);

    res.json({
      conversationId: state.id,
      summary: result.summary,
      history: historyText,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Pipeline failed",
    });
  }
});

export default router;
