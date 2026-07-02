import { Router, Request, Response } from "express";
import { tripPlanningAgent, TripPlanningInput } from "../agents/tripPlanning/agent";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { destination, local_attractions, recommended_duration_days } = req.body ?? {};

  if (
    typeof destination !== "string" ||
    !Array.isArray(local_attractions) ||
    typeof recommended_duration_days !== "number"
  ) {
    res.status(400).json({
      error:
        "Body must include: destination (string), local_attractions (string[]), recommended_duration_days (number)",
    });
    return;
  }

  const input: TripPlanningInput = { destination, local_attractions, recommended_duration_days };

  try {
    const result = await tripPlanningAgent(input);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Trip planning failed",
    });
  }
});

export default router;
