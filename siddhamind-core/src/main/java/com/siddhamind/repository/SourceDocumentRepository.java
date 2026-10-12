package com.siddhamind.repository;

import com.siddhamind.entity.SourceDocument;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface SourceDocumentRepository extends JpaRepository<SourceDocument, Long> {

    Optional<SourceDocument> findBySlug(String slug);

    List<SourceDocument> findAllByOrderByUploadedAtDesc();

    long countByIndexedTrue();

    List<SourceDocument> findByIngestStatus(String ingestStatus);

    /** Corpus size for the dashboards, summed in the database rather than in Java. */
    @Query("SELECT COALESCE(SUM(d.chunkCount), 0) FROM SourceDocument d")
    long sumChunkCount();
}
