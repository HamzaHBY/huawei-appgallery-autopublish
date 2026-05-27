// Lightweight DB-polling worker. Picks up queued jobs and runs them.
// Run with: `npm run worker` (separate process from Next.js).
import { prisma } from "../lib/db";
import { runPreparationPipeline, publishApprovedUpload } from "../lib/workflow";

const POLL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || "5000", 10);

async function processOneJob() {
  // Atomically claim a job using a transaction
  const job = await prisma.$transaction(async (tx) => {
    const candidate = await tx.job.findFirst({
      where: {
        status: "QUEUED",
        scheduledAt: { lte: new Date() },
      },
      orderBy: { scheduledAt: "asc" },
    });
    if (!candidate) return null;
    return tx.job.update({
      where: { id: candidate.id },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
  });

  if (!job) return false;

  try {
    if (job.kind === "PARSE_APK") {
      await runPreparationPipeline(job.uploadId);
    } else if (job.kind === "PUBLISH_TO_HUAWEI") {
      await publishApprovedUpload(job.uploadId);
    } else {
      // Other kinds are subsumed in PARSE_APK pipeline; mark succeeded.
    }
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", finishedAt: new Date() },
    });
  } catch (err) {
    const message = (err as Error).message;
    const status = job.attempts >= job.maxAttempts ? "FAILED" : "QUEUED";
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status,
        errorMessage: message,
        finishedAt: status === "FAILED" ? new Date() : null,
        scheduledAt:
          status === "QUEUED" ? new Date(Date.now() + 30_000 * job.attempts) : job.scheduledAt,
      },
    });
  }
  return true;
}

async function main() {
  console.log(`[worker] started, polling every ${POLL_MS}ms`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const did = await processOneJob();
      if (!did) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      console.error("[worker] tick failed:", err);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
