import { generateWithRetry } from "../../utils/gemini";
import { extractJsonSafely } from "../../utils/extractJson";

export interface BudgetTripInput {
  destination: string;
  duration_days: number;
  itinerary: { day: number; activities: string[] }[];
}

interface CurrencySummary {
  min: number;
  median: number;
  max: number;
  samples: number;
}

export interface BudgetReasoningResult {
  destination: string;
  preferred_currency: string;
  hotel_research: Record<string, CurrencySummary>;
  activity_research: Record<string, CurrencySummary>;
  confidence: "low" | "medium" | "high";
  total_price_samples: number;
  execution_time_seconds: number;
  sources: string[];
}

export async function budgetReasoningAgent(
  trip: BudgetTripInput,
  preferredCurrency = "USD"
): Promise<BudgetReasoningResult> {
  const start = Date.now();

  const activities = [...new Set(trip.itinerary.flatMap(d => d.activities))];

  const prompt = `You are a travel budget expert.

Destination: ${trip.destination}
Duration: ${trip.duration_days} days
Currency: ${preferredCurrency}
Activities: ${JSON.stringify(activities)}

Provide realistic budget estimates for:
1. Hotels (per night, budget/mid-range/luxury)
2. Each activity (entry fees, tours, etc.)

Base estimates on real-world knowledge of ${trip.destination} tourism prices.

Respond with ONLY valid JSON:
{
  "hotel_research": {
    "${preferredCurrency}": {
      "min": number,
      "median": number,
      "max": number,
      "samples": 10
    }
  },
  "activity_research": {
    "${preferredCurrency}": {
      "min": number,
      "median": number,
      "max": number,
      "samples": ${activities.length}
    }
  },
  "confidence": "medium"
}`;

  try {
    const text = await generateWithRetry(prompt);
    const result = extractJsonSafely(text) as {
      hotel_research?: Record<string, CurrencySummary>;
      activity_research?: Record<string, CurrencySummary>;
      confidence?: "low" | "medium" | "high";
    };

    return {
      destination: trip.destination,
      preferred_currency: preferredCurrency,
      hotel_research: result.hotel_research ?? {},
      activity_research: result.activity_research ?? {},
      confidence: result.confidence ?? "medium",
      total_price_samples: 10,
      execution_time_seconds: Math.round((Date.now() - start) / 1000),
      sources: ["AI estimate based on tourism data"],
    };
  } catch {
    // Fallback — return empty but don't crash the pipeline
    return {
      destination: trip.destination,
      preferred_currency: preferredCurrency,
      hotel_research: {},
      activity_research: {},
      confidence: "low",
      total_price_samples: 0,
      execution_time_seconds: Math.round((Date.now() - start) / 1000),
      sources: [],
    };
  }
}
