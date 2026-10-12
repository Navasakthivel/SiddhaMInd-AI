package com.siddhamind.repository;

import com.siddhamind.entity.SafetyCheck;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SafetyCheckRepository extends JpaRepository<SafetyCheck, Long> {

    /** Backed by ix_safety_user_created - no composite index to declare separately, unlike Firestore. */
    List<SafetyCheck> findByUser_UserIdOrderByCreatedAtDesc(Long userId);

    List<SafetyCheck> findAllByOrderByCreatedAtDesc(Pageable pageable);

    long countByRiskLevel(String riskLevel);
}
