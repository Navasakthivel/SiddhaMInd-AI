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

import java.time.Instant;

/**
 * Corpus metadata. The chunks and their embeddings live in {@code doc_chunks}, which
 * siddhamind-ai owns and which is deliberately not mapped as a JPA entity - Java has
 * no reason to read a 1024-dimension vector, and mapping it would drag a pgvector
 * Hibernate type into this service for nothing.
 *
 * <p>Java creates this row on upload; the Python ingestion pipeline updates
 * {@code ingestStatus}, {@code chunkCount} and {@code skippedPages} as it runs.
 */
@Entity
@Table(name = "source_documents")
public class SourceDocument {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "doc_id")
    private Long docId;

    @Column(nullable = false, unique = true, length = 100)
    private String slug;

    @Column(nullable = false, length = 300)
    private String title;

    @Column(length = 300)
    private String author;

    @Column(name = "book_code", length = 50)
    private String bookCode;

    @Column(length = 30)
    private String language;

    @Column(name = "total_pages")
    private Integer totalPages;

    @Column(name = "file_path", length = 500)
    private String filePath;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "uploaded_by", foreignKey = @ForeignKey(name = "fk_docs_uploader"))
    private User uploadedBy;

    @Column(name = "uploaded_at", nullable = false)
    private Instant uploadedAt = Instant.now();

    @Column(nullable = false)
    private boolean indexed;

    @Column(name = "chunk_count", nullable = false)
    private int chunkCount;

    /** PENDING | RUNNING | COMPLETE | FAILED - also enforced by a CHECK constraint. */
    @Column(name = "ingest_status", nullable = false, length = 20)
    private String ingestStatus = "PENDING";

    @Column(name = "ingest_error", columnDefinition = "TEXT")
    private String ingestError;

    /** Pages OCR skipped for low confidence - recorded, never silently dropped. */
    @Column(name = "skipped_pages", nullable = false)
    private int skippedPages;

    @Column(name = "last_indexed_at")
    private Instant lastIndexedAt;

    public SourceDocument() {}

    public Long getDocId() { return docId; }
    public void setDocId(Long docId) { this.docId = docId; }

    public String getSlug() { return slug; }
    public void setSlug(String slug) { this.slug = slug; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getAuthor() { return author; }
    public void setAuthor(String author) { this.author = author; }

    public String getBookCode() { return bookCode; }
    public void setBookCode(String bookCode) { this.bookCode = bookCode; }

    public String getLanguage() { return language; }
    public void setLanguage(String language) { this.language = language; }

    public Integer getTotalPages() { return totalPages; }
    public void setTotalPages(Integer totalPages) { this.totalPages = totalPages; }

    public String getFilePath() { return filePath; }
    public void setFilePath(String filePath) { this.filePath = filePath; }

    public User getUploadedBy() { return uploadedBy; }
    public void setUploadedBy(User uploadedBy) { this.uploadedBy = uploadedBy; }

    public Instant getUploadedAt() { return uploadedAt; }
    public void setUploadedAt(Instant uploadedAt) { this.uploadedAt = uploadedAt; }

    public boolean isIndexed() { return indexed; }
    public void setIndexed(boolean indexed) { this.indexed = indexed; }

    public int getChunkCount() { return chunkCount; }
    public void setChunkCount(int chunkCount) { this.chunkCount = chunkCount; }

    public String getIngestStatus() { return ingestStatus; }
    public void setIngestStatus(String ingestStatus) { this.ingestStatus = ingestStatus; }

    public String getIngestError() { return ingestError; }
    public void setIngestError(String ingestError) { this.ingestError = ingestError; }

    public int getSkippedPages() { return skippedPages; }
    public void setSkippedPages(int skippedPages) { this.skippedPages = skippedPages; }

    public Instant getLastIndexedAt() { return lastIndexedAt; }
    public void setLastIndexedAt(Instant lastIndexedAt) { this.lastIndexedAt = lastIndexedAt; }
}
