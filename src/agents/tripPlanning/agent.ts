import { generateWithRetry } from "../../utils/gemini";
import { extractJsonSafely } from "../../utils/extractJson";

export interface TripPlanningInput {
  destination: string;
  local_attractions: string[];
  recommended_duration_days: number;
}

export interface ItineraryDay {
  day: number;
  theme: string;
  activities: string[];
}

export interface TripPlanningResult {
  destination: string;
  duration_days: number;
  itinerary: ItineraryDay[];
  confidence: "low" | "medium" | "high";
}

export async function tripPlanningAgent(
  input: TripPlanningInput
): Promise<TripPlanningResult> {
  const { destination, local_attractions, recommended_duration_days } = input;

  const prompt = `
You are a trip planning agent.

Create a balanced, realistic day-wise travel itinerary.

STRICT RULES:
- Use ONLY the attractions provided below
- Do NOT invent new places
- Max 2–3 activities per day
- Group similar or nearby activities
- Balance adventure and relaxation
- Assign a short theme to each day

INPUT:
Destination: ${destination}
Duration (days): ${recommended_duration_days}
Attractions:
${JSON.stringify(local_attractions)}

Respond with ONLY valid JSON.

SCHEMA:
{
  "destination": string,
  "duration_days": number,
  "itinerary": [
    {
      "day": number,
      "theme": string,
      "activities": string[]
    }
  ],
  "confidence": "low" | "medium" | "high"
}
`;

  const text = await generateWithRetry(prompt);
  return extractJsonSafely(text) as TripPlanningResult;
}
