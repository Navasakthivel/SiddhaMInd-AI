package com.siddhamind.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.ForeignKey;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

/**
 * A source reference on an assistant answer.
 *
 * <p>{@code chunkId} is a plain column rather than an association: {@code doc_chunks}
 * is owned by siddhamind-ai and not mapped here. The FK still exists in the database
 * with ON DELETE SET NULL, so re-ingesting a book leaves old citations readable
 * through their denormalized book, page and snippet.
 */
@Entity
@Table(name = "chat_message_citations")
public class ChatMessageCitation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "citation_id")
    private Long citationId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "message_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_cite_message"))
    private ChatMessage message;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "source_document_id", foreignKey = @ForeignKey(name = "fk_cite_document"))
    private SourceDocument sourceDocument;

    @Column(name = "chunk_id")
    private Long chunkId;

    @Column(name = "book_name", length = 300)
    private String bookName;

    @Column(name = "page_no")
    private Integer pageNo;

    @Column(name = "verse_no", length = 30)
    private String verseNo;

    @Column(name = "chunk_index")
    private Integer chunkIndex;

    /** The passage number the model was told to cite, 1-based. */
    @Column(name = "passage_no")
    private Integer passageNo;

    @Column(columnDefinition = "TEXT")
    private String snippet;

    private Double score;

    public ChatMessageCitation() {}

    public Long getCitationId() { return citationId; }
    public void setCitationId(Long citationId) { this.citationId = citationId; }

    public ChatMessage getMessage() { return message; }
    public void setMessage(ChatMessage message) { this.message = message; }

    public SourceDocument getSourceDocument() { return sourceDocument; }
    public void setSourceDocument(SourceDocument sourceDocument) { this.sourceDocument = sourceDocument; }

    public Long getChunkId() { return chunkId; }
    public void setChunkId(Long chunkId) { this.chunkId = chunkId; }

    public String getBookName() { return bookName; }
    public void setBookName(String bookName) { this.bookName = bookName; }

    public Integer getPageNo() { return pageNo; }
    public void setPageNo(Integer pageNo) { this.pageNo = pageNo; }

    public String getVerseNo() { return verseNo; }
    public void setVerseNo(String verseNo) { this.verseNo = verseNo; }

    public Integer getChunkIndex() { return chunkIndex; }
    public void setChunkIndex(Integer chunkIndex) { this.chunkIndex = chunkIndex; }

    public Integer getPassageNo() { return passageNo; }
    public void setPassageNo(Integer passageNo) { this.passageNo = passageNo; }

    public String getSnippet() { return snippet; }
    public void setSnippet(String snippet) { this.snippet = snippet; }

    public Double getScore() { return score; }
    public void setScore(Double score) { this.score = score; }
}
