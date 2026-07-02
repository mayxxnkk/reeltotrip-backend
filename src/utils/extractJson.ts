export function extractJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // ignore
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // ignore
    }
  }

  throw new Error("No valid JSON found in Gemini response");
}
