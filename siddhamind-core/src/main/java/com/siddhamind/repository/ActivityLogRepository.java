package com.siddhamind.repository;

import com.siddhamind.entity.ActivityLog;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ActivityLogRepository extends JpaRepository<ActivityLog, Long> {

    /** User fetched eagerly - the admin reports table shows who did what. */
    @EntityGraph(attributePaths = "user")
    List<ActivityLog> findAllByOrderByCreatedAtDesc(Pageable pageable);

    List<ActivityLog> findByUser_UserIdOrderByCreatedAtDesc(Long userId);
}
