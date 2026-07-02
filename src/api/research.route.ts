import { Router, Request, Response } from "express";
import { destinationResearchAgent, ReelInsight } from "../agents/destinationResearch/agent";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { destination, country, vibe, key_activities } = req.body ?? {};

  if (
    typeof destination !== "string" ||
    typeof country !== "string" ||
    !Array.isArray(vibe) ||
    !Array.isArray(key_activities)
  ) {
    res.status(400).json({
      error:
        "Body must include: destination (string), country (string), vibe (string[]), key_activities (string[])",
    });
    return;
  }

  const reelInsight: ReelInsight = { destination, country, vibe, key_activities };

  try {
    const result = await destinationResearchAgent(reelInsight);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Destination research failed",
    });
  }
});

export default router;
