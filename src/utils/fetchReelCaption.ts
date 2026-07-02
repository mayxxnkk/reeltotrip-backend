import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const BROWSERS = ["chrome", "edge", "firefox"];

async function tryFetchWithBrowser(reelUrl: string, browser: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("yt-dlp", [
      "-j",
      "--skip-download",
      "--cookies-from-browser",
      browser,
      reelUrl,
    ], { encoding: "utf8", maxBuffer: 1024 * 1024 });

    const info = JSON.parse(stdout) as { description?: string };
    const caption = (info.description ?? "").trim();
    return caption || null;
  } catch {
    return null;
  }
}

async function tryFetchNoCookies(reelUrl: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("yt-dlp", [
      "-j",
      "--skip-download",
      reelUrl,
    ], { encoding: "utf8", maxBuffer: 1024 * 1024 });

    const info = JSON.parse(stdout) as { description?: string };
    const caption = (info.description ?? "").trim();
    return caption || null;
  } catch {
    return null;
  }
}

export async function fetchReelCaptionSafe(reelUrl: string): Promise<string | null> {
  // Try each browser in order — Chrome may be locked if it's open
  for (const browser of BROWSERS) {
    console.log(`[yt-dlp] Trying cookies from: ${browser}`);
    const caption = await tryFetchWithBrowser(reelUrl, browser);
    if (caption) {
      console.log(`[yt-dlp] Got caption via ${browser} cookies`);
      return caption;
    }
  }

  // Last resort: no cookies (works for public reels)
  console.log("[yt-dlp] Trying without cookies (public reel)...");
  const caption = await tryFetchNoCookies(reelUrl);
  if (caption) {
    console.log("[yt-dlp] Got caption without cookies");
    return caption;
  }

  console.warn("[WARN] Could not fetch reel caption via any method. Proceeding with URL-only inference.");
  return null;
}
