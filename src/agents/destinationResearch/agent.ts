import { generateWithRetry } from "../../utils/gemini";
import { extractJsonSafely } from "../../utils/extractJson";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const USER_AGENT = "travel-agent/1.0 (education project)";

export interface ReelInsight {
  destination: string;
  country: string;
  vibe: string[];
  key_activities: string[];
}

export interface DestinationResearchResult {
  destination: string;
  local_attractions: string[];
  recommended_duration_days: number;
  confidence: "low" | "medium" | "high";
}

function parseCity(destination: string | null): string {
  if (!destination) return "";
  if (destination.includes(",")) {
    return destination.split(",").pop()!.trim();
  }
  return destination.trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nominatimLookup(
  query: string
): Promise<{ lat: number; lon: number } | null> {
  const url = new URL(NOMINATIM_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { lat: string; lon: string }[];
    if (!data.length) return null;

    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

async function getCityCoordinates(
  destination: string,
  city: string,
  country: string
): Promise<{ lat: number; lon: number } | null> {
  const queries = [
    `${city}, ${country}`,
    `${destination}, ${country}`,
    destination,
    city,
    country,
  ];

  for (const q of queries) {
    console.log(`[geocode] Trying: "${q}"`);
    const result = await nominatimLookup(q);
    if (result) {
      console.log(`[geocode] Found: lat=${result.lat}, lon=${result.lon}`);
      return result;
    }
    await delay(1100);
  }

  console.warn(
    `[geocode] All lookups failed for destination="${destination}", city="${city}", country="${country}"`
  );
  return null;
}

async function getNearbyAttractions(
  lat: number,
  lon: number,
  radius = 5000
): Promise<string[]> {
  const query = `
    [out:json][timeout:30];
    (
      node["tourism"]["name"](around:${radius},${lat},${lon});
      node["natural"]["name"](around:${radius},${lat},${lon});
      node["leisure"]["name"](around:${radius},${lat},${lon});
      way["tourism"]["name"](around:${radius},${lat},${lon});
    );
    out tags;
  `;

  for (const url of OVERPASS_URLS) {
    try {
      console.log(`[overpass] Trying: ${url}`);
      const res = await fetch(url, {
        method: "POST",
        body: query,
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(35000),
      });

      if (!res.ok) {
        console.warn(`[overpass] ${url} returned ${res.status}, trying next...`);
        continue;
      }

      const json = (await res.json()) as {
        elements: { tags?: { name?: string } }[];
      };

      const names = new Set<string>();
      for (const el of json.elements) {
        const name = el.tags?.name;
        if (name) names.add(name);
      }

      console.log(`[overpass] Got ${names.size} attractions from ${url}`);
      return Array.from(names);
    } catch (err) {
      console.warn(`[overpass] ${url} failed: ${err}, trying next...`);
    }
  }

  console.warn("[overpass] All mirrors failed, continuing with empty attractions list");
  return [];
}

export async function destinationResearchAgent(
  reelInsight: ReelInsight
): Promise<DestinationResearchResult> {
  const { destination, country, vibe, key_activities } = reelInsight;

  // If Gemini couldn't infer a destination (reel was inaccessible), return a low-confidence fallback
  if (!destination || !country) {
    console.warn("[destinationResearch] No destination inferred from reel. Returning fallback.");
    return {
      destination: destination ?? "Unknown",
      local_attractions: [],
      recommended_duration_days: 3,
      confidence: "low",
    };
  }

  const city = parseCity(destination);
  const coords = await getCityCoordinates(destination, city, country);

  let attractions: string[] = [];
  if (coords) {
    attractions = await getNearbyAttractions(coords.lat, coords.lon);
  }

  // Filter to named attractions only, deduplicate, and cap at 80
  // Overpass returns thousands of raw OSM nodes — most are unnamed noise
  const trimmedAttractions = attractions
    .filter((name) => name.length > 3)           // drop single-char or very short names
    .filter((name) => !/^\d/.test(name))          // drop names starting with numbers (addresses)
    .slice(0, 80);

  const prompt = `
You are a travel research agent.

Destination: ${destination}
Country: ${country}
Vibe: ${JSON.stringify(vibe)}
Key Activities: ${JSON.stringify(key_activities)}

Nearby Attractions (raw list, max 50):
${JSON.stringify(trimmedAttractions)}

TASK:
- Select the 5–7 most relevant attractions
- Recommend an ideal trip duration in days

Respond with ONLY valid JSON.

SCHEMA:
{
  "destination": string,
  "local_attractions": string[],
  "recommended_duration_days": number,
  "confidence": "low" | "medium" | "high"
}
`;

  const text = await generateWithRetry(prompt);
  return extractJsonSafely(text) as DestinationResearchResult;
}
