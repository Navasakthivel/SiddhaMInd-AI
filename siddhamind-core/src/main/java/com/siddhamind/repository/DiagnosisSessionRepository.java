package com.siddhamind.repository;

import com.siddhamind.entity.DiagnosisSession;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DiagnosisSessionRepository extends JpaRepository<DiagnosisSession, Long> {

    List<DiagnosisSession> findByPractitioner_UserIdOrderByCreatedAtDesc(Long practitionerId);

    List<DiagnosisSession> findAllByOrderByCreatedAtDesc(Pageable pageable);

    /**
     * Every session, newest first.
     *
     * <p>Unpaged overload of the method above, for the admin scope of
     * {@code GET /api/diagnosis/history}. The paged variant backs the admin
     * dashboard, which shows only the ten most recent; the history endpoint is the
     * full list, so capping it with an arbitrary page size would silently truncate
     * the answer.
     */
    List<DiagnosisSession> findAllByOrderByCreatedAtDesc();
}
