package com.siddhamind.repository;

import com.siddhamind.entity.ChatMessage;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {

    /** Citations fetched with the messages - the chat view renders both together. */
    @EntityGraph(attributePaths = "citations")
    List<ChatMessage> findByChatSession_ChatIdOrderByCreatedAtAsc(Long chatId);

    long countByChatSession_ChatId(Long chatId);
}
