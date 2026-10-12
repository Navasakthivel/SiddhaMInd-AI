package com.siddhamind.dto;

/**
 * One source reference from siddhamind-ai's {@code /query} response.
 *
 * <p>Field-for-field with the Python {@code Citation} model and with
 * {@link com.siddhamind.entity.ChatMessageCitation}, so persistence is a copy
 * rather than a translation. {@code sourceDocumentId} is the one difference: it
 * arrives as an id and is resolved to a {@code SourceDocument} when persisted.
 *
 * <p><b>{@code score} is a fused reciprocal-rank-fusion score, not a similarity.</b>
 * It is roughly 0.016-0.033 in practice and is meaningful only as an ordering
 * within one response - a top hit and a weak hit differ in the third decimal
 * place. Rendering it as a percentage would tell a practitioner that the best
 * available passage was "3% relevant". Use it to sort; show the rank, or nothing.
 */
public record RagCitation(
        Integer passageNo,
        Long chunkId,
        Long sourceDocumentId,
        String bookName,
        Integer pageNo,
        String verseNo,
        Integer chunkIndex,
        String snippet,
        Double score) {

    /** Book, page and verse as a practitioner would cite them. */
    public String label() {
        StringBuilder sb = new StringBuilder(bookName == null ? "Unknown source" : bookName);
        if (pageNo != null) {
            sb.append(", p.").append(pageNo);
        }
        if (verseNo != null && !verseNo.isBlank()) {
            sb.append(", v.").append(verseNo);
        }
        return sb.toString();
    }
}
