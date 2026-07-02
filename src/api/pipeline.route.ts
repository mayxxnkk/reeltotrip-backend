import { Router, Request, Response } from "express";
import { runPipeline } from "../orchestrator/orchestrator";
import {
  createConversation,
  buildHistoryText,
} from "../memory/conversationState";

const router = Router();

// In-memory job store for async pipeline results
interface Job {
  status: "pending" | "done" | "error";
  result?: { conversationId: string; summary: string; history: string };
  error?: string;
}
const jobs = new Map<string, Job>();

function generateJobId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// POST /pipeline — starts job, returns jobId immediately
router.post("/", async (req: Request, res: Response) => {
  const reelUrl = req.body?.reelUrl;
  const currency: string =
    typeof req.body?.currency === "string" ? req.body.currency : "USD";
  const destinationOverride: string | undefined =
    typeof req.body?.destination === "string" && req.body.destination.trim()
      ? req.body.destination.trim()
      : undefined;

  if (typeof reelUrl !== "string" || !reelUrl.trim()) {
    res.status(400).json({ error: "Missing or invalid reelUrl" });
    return;
  }

  const jobId = generateJobId();
  jobs.set(jobId, { status: "pending" });

  // Run pipeline in background — don't await
  (async () => {
    try {
      const result = await runPipeline(reelUrl.trim(), currency, undefined, destinationOverride);
      const state = createConversation(
        reelUrl.trim(),
        currency,
        `New reel: ${reelUrl.trim()}`,
        result.summary,
        result.reelInterpretation.destination
      );
      jobs.set(jobId, {
        status: "done",
        result: {
          conversationId: state.id,
          summary: result.summary,
          history: buildHistoryText(state),
        },
      });
    } catch (e) {
      jobs.set(jobId, {
        status: "error",
        error: e instanceof Error ? e.message : "Pipeline failed",
      });
    }
  })();

  // Return jobId immediately so frontend can poll
  res.json({ jobId, status: "pending" });
});

// GET /pipeline/status/:jobId — poll for result
router.get("/status/:jobId", (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status === "pending") {
    res.json({ status: "pending" });
    return;
  }
  if (job.status === "error") {
    res.status(500).json({ status: "error", error: job.error });
    return;
  }
  // Done — return result and clean up
  jobs.delete(req.params.jobId);
  res.json({ status: "done", ...job.result });
});

export default router;
