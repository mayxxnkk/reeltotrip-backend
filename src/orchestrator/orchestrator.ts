import {
  reelInterpretationAgent,
  ReelInterpretationResult,
} from "../agents/reelInterpretation/agent";
import {
  destinationResearchAgent,
  DestinationResearchResult,
} from "../agents/destinationResearch/agent";
import {
  tripPlanningAgent,
  TripPlanningResult,
} from "../agents/tripPlanning/agent";
import {
  budgetReasoningAgent,
  BudgetReasoningResult,
} from "../agents/budgetReasoning/agent";
import { generateWithRetry } from "../utils/gemini";

export interface PipelineResult {
  reelInterpretation: ReelInterpretationResult;
  destinationResearch: DestinationResearchResult;
  tripPlan: TripPlanningResult;
  budgetEstimate: BudgetReasoningResult;
  summary: string;
}

export async function runPipeline(
  reelUrl: string,
  currency = "USD",
  conversationContext?: string,
  destinationOverride?: string
): Promise<PipelineResult> {
  console.log("[pipeline] Step 1: Reel interpretation...");
  const reelInterpretation = await reelInterpretationAgent(reelUrl, destinationOverride);
  console.log("[pipeline] Reel interpretation result:", JSON.stringify(reelInterpretation, null, 2));

  console.log("[pipeline] Step 2: Destination research...");
  const destinationResearch = await destinationResearchAgent({
    destination: reelInterpretation.destination,
    country: reelInterpretation.country,
    vibe: reelInterpretation.vibe,
    key_activities: reelInterpretation.key_activities,
  });
  console.log("[pipeline] Destination research result:", JSON.stringify(destinationResearch, null, 2));

  console.log("[pipeline] Step 3: Trip planning...");
  const tripPlan = await tripPlanningAgent({
    destination: destinationResearch.destination,
    local_attractions: destinationResearch.local_attractions,
    recommended_duration_days: destinationResearch.recommended_duration_days,
  });
  console.log("[pipeline] Trip plan result:", JSON.stringify(tripPlan, null, 2));

  console.log(`[pipeline] Step 4: Budget reasoning (currency: ${currency})...`);
  const budgetEstimate = await budgetReasoningAgent(
    {
      destination: tripPlan.destination,
      duration_days: tripPlan.duration_days,
      itinerary: tripPlan.itinerary,
    },
    currency
  );
  console.log("[pipeline] Budget estimate result:", JSON.stringify(budgetEstimate, null, 2));

  console.log("[pipeline] Step 5: Generating human-friendly summary...");

  const contextSection = conversationContext
    ? `Previous conversation:\n${conversationContext}\n\nThe user's latest message is at the end of this conversation. Adjust the trip and budget explanation to reflect that request.\n\n`
    : "";

  const summaryPrompt = `
You are a helpful travel planner.

The user shared an Instagram reel and wants a trip inspired by it.

${contextSection}

Here is the structured analysis you already have:

Reel interpretation:
${JSON.stringify(reelInterpretation, null, 2)}

Destination research:
${JSON.stringify(destinationResearch, null, 2)}

Trip plan:
${JSON.stringify(tripPlan, null, 2)}

Budget estimate:
${JSON.stringify(budgetEstimate, null, 2)}

TASK:
- Write a friendly, human-readable response to the user.
- Briefly describe the destination and overall vibe of the trip.
- Summarize the itinerary day by day.
- Give an approximate budget range using the preferred currency and hotel/activity research.
- Mention that prices are estimates and can vary.

IMPORTANT:
- Respond as normal paragraphs or short bullet points, not JSON.
- Do NOT restate the raw JSON. Turn it into natural language.
`;

  const summary = await generateWithRetry(summaryPrompt);

  return {
    reelInterpretation,
    destinationResearch,
    tripPlan,
    budgetEstimate,
    summary,
  };
}
