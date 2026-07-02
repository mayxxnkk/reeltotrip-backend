import puppeteer, { Browser } from "puppeteer";

// Hard cap — user gets a response within this time no matter what
const MAX_TOTAL_TIME = 45_000;
const PAGE_TIMEOUT  = 12_000;
const WAIT_MS       = 4_000;

// ── Currency patterns ────────────────────────────────────────────────────────
// Order matters: longer/more-specific prefixes must come before shorter ones
// to avoid S$ being swallowed by the bare $ pattern.
interface CurrencyPattern { iso: string; prefix: RegExp; min: number; max: number }

const CURRENCY_PATTERNS: CurrencyPattern[] = [
  { iso: "AUD", prefix: /A\$\s?/,            min: 1,     max: 50_000 },
  { iso: "CAD", prefix: /C\$\s?/,            min: 1,     max: 50_000 },
  { iso: "SGD", prefix: /S\$\s?/,            min: 1,     max: 50_000 },
  { iso: "HKD", prefix: /HK\$\s?/,           min: 1,     max: 500_000 },
  { iso: "USD", prefix: /(?<![A-Z])\$\s?/,   min: 1,     max: 50_000 },
  { iso: "GBP", prefix: /£\s?/,              min: 1,     max: 50_000 },
  { iso: "EUR", prefix: /€\s?/,              min: 1,     max: 50_000 },
  { iso: "INR", prefix: /₹\s?/,              min: 10,    max: 1_000_000 },
  { iso: "PHP", prefix: /₱\s?/,              min: 10,    max: 1_000_000 },
  { iso: "JPY", prefix: /¥\s?/,              min: 100,   max: 5_000_000 },
  { iso: "AED", prefix: /(?:AED|د\.إ)\s?/i,  min: 1,     max: 500_000 },
  { iso: "THB", prefix: /฿\s?/,              min: 10,    max: 1_000_000 },
  { iso: "MYR", prefix: /RM\s?/,             min: 1,     max: 50_000 },
  { iso: "IDR", prefix: /Rp\.?\s?/,          min: 1_000, max: 1_000_000_000 },
  { iso: "VND", prefix: /₫\s?/,              min: 1_000, max: 1_000_000_000 },
];

const NUM_PATTERN = /([\d,]+(?:\.\d{1,2})?)/;

interface PriceEntry { currency: string; amount: number }

function extractPrices(text: string): PriceEntry[] {
  const prices: PriceEntry[] = [];
  const seen = new Set<string>();
  for (const { iso, prefix, min, max } of CURRENCY_PATTERNS) {
    const re = new RegExp(prefix.source + NUM_PATTERN.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const val = parseFloat(m[1].replace(/,/g, ""));
      if (isNaN(val) || val < min || val > max) continue;
      const key = `${iso}:${val}`;
      if (!seen.has(key)) { seen.add(key); prices.push({ currency: iso, amount: val }); }
    }
  }
  return prices;
}

// ── Browser helpers ──────────────────────────────────────────────────────────
async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage",
           "--disable-blink-features=AutomationControlled", "--window-size=1920,1080"],
  });
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function scrapeBooking(city: string, currencyCode: string): Promise<PriceEntry[]> {
  const checkin  = new Date(Date.now() + 7  * 86_400_000).toISOString().slice(0, 10);
  const checkout = new Date(Date.now() + 11 * 86_400_000).toISOString().slice(0, 10);
  const url = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(city)}&checkin=${checkin}&checkout=${checkout}&group_adults=2&no_rooms=1&selected_currency=${currencyCode}`;

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    console.log(`[Booking] ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });

    // Wait a bit for prices to render
    await new Promise(r => setTimeout(r, WAIT_MS));

    const selectors = [
      '[data-testid="price-and-discounted-price"]',
      '[data-testid="price"]',
      ".bui-price-display__value",
      ".prco-valign-middle-helper",
    ];

    let texts: string[] = [];
    for (const sel of selectors) {
      try {
        const results = await page.$$eval(sel, els => els.map(el => (el as any).textContent ?? ""));
        if (results.length) { texts = results; break; }
      } catch { continue; }
    }

    return texts.flatMap(extractPrices);
  } catch (e) {
    console.warn("[Booking] Error:", e instanceof Error ? e.message : String(e));
    return [];
  } finally {
    await browser.close();
  }
}

async function scrapeGYG(activity: string): Promise<PriceEntry[]> {
  const url = `https://www.getyourguide.com/s/?q=${encodeURIComponent(activity)}&searchSource=2`;
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
    await new Promise(r => setTimeout(r, WAIT_MS));

    const selectors = ['[data-testid="price-text"]', ".price", ".activity-price", 'span[itemprop="price"]'];
    let texts: string[] = [];
    for (const sel of selectors) {
      try {
        const results = await page.$$eval(sel, els => els.map(el => (el as any).textContent ?? ""));
        if (results.length) { texts = results; break; }
      } catch { continue; }
    }
    return texts.flatMap(extractPrices);
  } catch (e) {
    console.warn(`[GYG] ${activity} error:`, e instanceof Error ? e.message : String(e));
    return [];
  } finally {
    await browser.close();
  }
}

// ── Summary helpers ──────────────────────────────────────────────────────────
interface CurrencySummary { min: number; median: number; max: number; samples: number }

function summarize(prices: PriceEntry[]): Record<string, CurrencySummary> {
  const byCurrency: Record<string, number[]> = {};
  for (const p of prices) (byCurrency[p.currency] ??= []).push(p.amount);
  const result: Record<string, CurrencySummary> = {};
  for (const [cur, vals] of Object.entries(byCurrency)) {
    vals.sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    result[cur] = {
      min: vals[0],
      median: vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid],
      max: vals[vals.length - 1],
      samples: vals.length,
    };
  }
  return result;
}

// ── Public interface ─────────────────────────────────────────────────────────
export interface BudgetTripInput {
  destination: string;
  duration_days: number;
  itinerary: { day: number; activities: string[] }[];
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
  const city = trip.destination.split(",").pop()!.trim();

  // Collect unique activities across all days
  const activities = [...new Set(trip.itinerary.flatMap(d => d.activities))];

  // Race all scraping tasks against a hard timeout — run in parallel
  const deadline = new Promise<null>(r => setTimeout(() => r(null), MAX_TOTAL_TIME));

  const [hotelResult, ...gygResults] = await Promise.all([
    Promise.race([scrapeBooking(city, preferredCurrency), deadline]),
    ...activities.map(act =>
      Promise.race([scrapeGYG(act).then(p => { console.log(`[GYG] ${act} → ${p.length} prices`); return p; }), deadline])
    ),
  ]);

  const hotelPrices: PriceEntry[]    = (hotelResult as PriceEntry[] | null) ?? [];
  const activityPrices: PriceEntry[] = (gygResults as (PriceEntry[] | null)[])
    .flatMap(r => r ?? []);

  const hotelSummary    = summarize(hotelPrices);
  const activitySummary = summarize(activityPrices);
  const totalSamples    =
    Object.values(hotelSummary).reduce((s, v) => s + v.samples, 0) +
    Object.values(activitySummary).reduce((s, v) => s + v.samples, 0);

  return {
    destination: trip.destination,
    preferred_currency: preferredCurrency,
    hotel_research: hotelSummary,
    activity_research: activitySummary,
    confidence: totalSamples >= 10 ? "high" : totalSamples >= 5 ? "medium" : "low",
    total_price_samples: totalSamples,
    execution_time_seconds: Math.round((Date.now() - start) / 1000),
    sources: ["Booking.com", "GetYourGuide"],
  };
}
