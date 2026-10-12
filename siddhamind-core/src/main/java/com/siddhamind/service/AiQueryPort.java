package com.siddhamind.service;

import com.siddhamind.dto.RagAnswer;

import java.util.List;

/**
 * Retrieval-grounded question answering, delegated to siddhamind-ai.
 *
 * <p>Kept separate from {@link AiExplanationPort} because the two have opposite
 * relationships to the truth. An explanation phrases a result Java already
 * computed and must not be able to change it - hence that port's
 * {@code Optional<String>} return. A RAG answer <em>is</em> the content, produced
 * entirely on the Python side from the indexed corpus, and comes back
 * structured, with citations Java persists. Folding them into one interface
 * would mean widening the explanation return type to carry structure, which is
 * exactly the hole the split exists to prevent.
 *
 * <p>Never throws. Failure arrives as {@link RagAnswer#unavailable(String)}.
 */
public interface AiQueryPort {

    /**
     * @param question    the practitioner's question, Tamil or English
     * @param bookNames   optional restriction to particular books; may be null
     * @param documentIds optional restriction to particular documents; may be null
     */
    RagAnswer ask(String question, List<String> bookNames, List<Long> documentIds);

    default RagAnswer ask(String question) {
        return ask(question, null, null);
    }

    boolean isAvailable();
}
