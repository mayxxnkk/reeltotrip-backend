import { generateWithRetry } from "../../utils/gemini";
import { extractJsonSafely } from "../../utils/extractJson";
import { fetchReelCaptionSafe } from "../../utils/fetchReelCaption";

export interface ReelInterpretationResult {
  destination: string;
  country: string;
  vibe: string[];
  key_activities: string[];
  confidence: "low" | "medium" | "high";
}

export async function reelInterpretationAgent(reelUrl: string, destinationOverride?: string): Promise<ReelInterpretationResult> {
  // If user explicitly provided the destination, skip Groq entirely
  if (destinationOverride && destinationOverride.trim()) {
    console.log(`[reelInterpretation] Using user-provided destination: "${destinationOverride}"`);
    const parts = destinationOverride.split(",").map(s => s.trim());
    const destination = parts[0];
    const country = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    return {
      destination,
      country,
      vibe: ["travel", "exploration"],
      key_activities: ["sightseeing", "local experiences"],
      confidence: "high",
    };
  }

  let caption = await fetchReelCaptionSafe(reelUrl);
  const hasCaption = !!caption;
  if (!caption) {
    caption = "(caption unavailable — infer from URL only)";
  }

  // If user explicitly provided the destination, use it directly
  const destinationHint = destinationOverride
    ? `\nThe user has explicitly told us the destination is: "${destinationOverride}". Use this as the destination and country.`
    : "";

  const prompt = `
You are a travel intelligence agent.

Your job is to identify the travel destination from an Instagram reel.
${hasCaption ? "The caption was successfully fetched." : "The caption could not be fetched. Do your best to infer from the URL structure."}
${destinationHint}

IMPORTANT: Always return valid destination and country strings. Never return null.
If you cannot determine the exact destination, make a reasonable guess based on any available context.
Set confidence to "low" if guessing.

Reel URL:
${reelUrl}

Caption:
${caption}

Respond with ONLY valid JSON matching this schema exactly:

{
  "destination": string,
  "country": string,
  "vibe": string[],
  "key_activities": string[],
  "confidence": "low" | "medium" | "high"
}
`;

  const text = await generateWithRetry(prompt);
  const result = extractJsonSafely(text) as ReelInterpretationResult;

  // Final safety net — if Gemini still returns nulls, use fallback values
  return {
    destination: result.destination ?? "Unknown Destination",
    country: result.country ?? "Unknown",
    vibe: result.vibe ?? [],
    key_activities: result.key_activities ?? [],
    confidence: result.confidence ?? "low",
  };
}
