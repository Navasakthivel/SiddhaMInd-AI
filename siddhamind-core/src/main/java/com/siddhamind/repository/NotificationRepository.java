package com.siddhamind.repository;

import com.siddhamind.entity.Notification;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface NotificationRepository extends JpaRepository<Notification, Long> {

    List<Notification> findByUser_UserIdOrderByCreatedAtDesc(Long userId);

    long countByUser_UserIdAndReadFalse(Long userId);

    /** Scoped by user so a guessed notification ID cannot mark someone else's as read. */
    @Modifying
    @Query("UPDATE Notification n SET n.read = true WHERE n.notifId = :id AND n.user.userId = :userId")
    int markRead(@Param("id") Long notificationId, @Param("userId") Long userId);
}
