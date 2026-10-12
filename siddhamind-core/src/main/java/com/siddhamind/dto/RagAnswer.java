package com.siddhamind.dto;

import java.util.List;

/**
 * A retrieval-grounded answer from siddhamind-ai, mapped from {@code POST /query}.
 *
 * <p>Three outcomes are distinguishable, and conflating any two of them would
 * mislead the reader:
 *
 * <ul>
 *   <li><b>answered</b> - the corpus covered the question; {@code citations} is
 *       non-empty and every claim traces to a passage.</li>
 *   <li><b>not found in corpus</b> - retrieval found nothing relevant enough, so
 *       no model was called at all. A legitimate final answer, not a failure.</li>
 *   <li><b>unavailable</b> - the AI service could not be reached. The question
 *       is unanswered and retrying later may work.</li>
 * </ul>
 *
 * <p>The middle case is the one worth protecting: "the corpus does not cover
 * this" must never be shown as an outage, or a practitioner will assume the
 * information exists and retry, and it must never be shown as a normal answer,
 * or they will read the refusal as a finding.
 */
public record RagAnswer(
        String answer,
        List<RagCitation> citations,
        boolean notFoundInCorpus,
        int retrievalCount,
        String reason,
        boolean serviceUnavailable) {

    public RagAnswer {
        citations = citations == null ? List.of() : List.copyOf(citations);
        answer = answer == null ? "" : answer;
    }

    public static RagAnswer unavailable(String reason) {
        return new RagAnswer(
                "The assistant is temporarily unavailable. Your question has been saved - "
                        + "please try again shortly.",
                List.of(), false, 0, reason, true);
    }

    public boolean isGrounded() {
        return !serviceUnavailable && !notFoundInCorpus;
    }
}
