package com.siddhamind.service;

/**
 * Triggering corpus ingestion in siddhamind-ai.
 *
 * <p>Separate from {@link AiQueryPort} because it is a command, not a question:
 * it returns whether the run was accepted, and progress is then read from
 * {@code source_documents} - the same rows the Python service writes to. There
 * is no polling channel to keep in sync, because both services share one table.
 *
 * <p>Never throws. Failure arrives as {@link IngestTrigger#failed(String)}.
 */
public interface AiIngestPort {

    /**
     * @param sourceDocumentId the row to ingest
     * @return whether the AI service accepted the job
     */
    IngestTrigger trigger(Long sourceDocumentId);

    /**
     * Live state of one ingestion, for the corpus screen to poll.
     *
     * <p>The row in {@code source_documents} is already readable from here, so
     * the only thing this adds is {@link IngestStatus#running()} - whether the
     * AI process is still working on it. That distinction is the whole point:
     * a row left at RUNNING by a service that died looks exactly like one that
     * is still going, and only the process that owns the job can tell them
     * apart.
     *
     * <p>Never throws; an unreachable service arrives as
     * {@link IngestStatus#unavailable(String)}.
     */
    IngestStatus status(Long sourceDocumentId);

    boolean isAvailable();

    /** Outcome of asking the AI service to start a run. */
    record IngestTrigger(boolean accepted, String message) {

        public static IngestTrigger accepted(String message) {
            return new IngestTrigger(true, message);
        }

        public static IngestTrigger failed(String message) {
            return new IngestTrigger(false, message);
        }
    }

    /**
     * Live state of one ingestion.
     *
     * <p>THERE IS NO PERCENTAGE, and one is deliberately not derived here. The
     * pipeline writes {@code source_documents} exactly twice - RUNNING when it
     * starts, then the final status with the chunk count when it ends - and
     * {@code indexed} is a boolean, not a page counter. Nothing increments
     * while a run is in flight, so any figure between 0 and 100 would be
     * invented. {@code chunkCount} is the real number and it is 0 until the
     * run completes.
     *
     * <p>For a genuine percentage the pipeline would have to report progress as
     * it goes - writing pages-done against total_pages per batch - and this
     * record would carry it. Until then the UI shows a stage, not a fraction.
     *
     * @param reachable  false when the AI service could not be asked
     * @param status     PENDING | RUNNING | COMPLETE | FAILED, from the row
     * @param running    whether the AI process is actively working on it now
     * @param chunkCount chunks written; 0 until the run finishes
     * @param message    why the status is unavailable, when it is
     */
    record IngestStatus(boolean reachable, String status, boolean running, Integer chunkCount,
                        Integer totalPages, Integer skippedPages, String error, String message) {

        public static IngestStatus unavailable(String message) {
            return new IngestStatus(false, "UNKNOWN", false, null, null, null, null, message);
        }

        /**
         * True when the row says RUNNING but no process owns the job.
         *
         * <p>An ingestion whose service restarted mid-run leaves the row at
         * RUNNING for ever. Surfacing it as "still going" would have an admin
         * waiting on something that stopped.
         */
        public boolean isStalled() {
            return "RUNNING".equals(status) && !running;
        }
    }
}
