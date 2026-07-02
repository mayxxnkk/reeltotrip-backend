import { Router, Request, Response } from "express";
import { budgetReasoningAgent, BudgetTripInput } from "../agents/budgetReasoning/agent";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { destination, duration_days, itinerary, currency } = req.body ?? {};

  if (
    typeof destination !== "string" ||
    typeof duration_days !== "number" ||
    !Array.isArray(itinerary)
  ) {
    res.status(400).json({
      error:
        "Body must include: destination (string), duration_days (number), itinerary (array). Optional: currency (string, default USD)",
    });
    return;
  }

  const input: BudgetTripInput = { destination, duration_days, itinerary };
  const preferredCurrency: string = typeof currency === "string" ? currency : "USD";

  try {
    const result = await budgetReasoningAgent(input, preferredCurrency);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Budget reasoning failed",
    });
  }
});

export default router;
