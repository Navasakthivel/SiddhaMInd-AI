package com.siddhamind.repository;

import com.siddhamind.entity.ChatSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ChatSessionRepository extends JpaRepository<ChatSession, Long> {

    List<ChatSession> findByUser_UserIdOrderByCreatedAtDesc(Long userId);

    /**
     * Ownership-scoped lookup.
     *
     * <p>Used instead of {@code findById} everywhere a chat is opened or appended
     * to. A chat id is a sequential integer, so {@code findById} plus a check the
     * caller might forget is one missed branch away from letting any signed-in
     * user read another patient's consultation history by editing the URL. Making
     * the ownership part of the query removes the branch entirely.
     */
    Optional<ChatSession> findByChatIdAndUser_UserId(Long chatId, Long userId);
}
