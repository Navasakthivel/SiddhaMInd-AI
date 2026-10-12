package com.siddhamind.service;

import com.siddhamind.dto.RagAnswer;
import com.siddhamind.dto.RagCitation;
import com.siddhamind.entity.ChatMessage;
import com.siddhamind.entity.ChatMessageCitation;
import com.siddhamind.entity.ChatSession;
import com.siddhamind.entity.SourceDocument;
import com.siddhamind.entity.User;
import com.siddhamind.repository.ChatMessageRepository;
import com.siddhamind.repository.ChatSessionRepository;
import com.siddhamind.repository.SourceDocumentRepository;
import com.siddhamind.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The RAG assistant: sessions, messages, citations.
 *
 * <p>Structured like {@link SafetyService} and {@link DiagnosisService} - the
 * controller does routing and view binding, this holds the flow. The AI call
 * happens through {@link AiQueryPort}, which never throws, so the failure path
 * here is about what to persist rather than what to catch.
 *
 * <p><b>The user's question is persisted before the AI is called.</b> If the
 * service is down, the question survives and the conversation shows what was
 * asked alongside a message saying the assistant was unavailable. Persisting
 * afterwards would lose the question on exactly the occasions someone wants to
 * see it.
 */
@Service
public class AssistantService {

    private static final Logger log = LoggerFactory.getLogger(AssistantService.class);

    static final String SENDER_USER = "USER";
    static final String SENDER_ASSISTANT = "ASSISTANT";
    private static final int TITLE_MAX = 80;

    private final AiQueryPort aiQueryPort;
    private final ChatSessionRepository sessionRepository;
    private final ChatMessageRepository messageRepository;
    private final SourceDocumentRepository documentRepository;
    private final UserRepository userRepository;

    public AssistantService(AiQueryPort aiQueryPort,
                            ChatSessionRepository sessionRepository,
                            ChatMessageRepository messageRepository,
                            SourceDocumentRepository documentRepository,
                            UserRepository userRepository) {
        this.aiQueryPort = aiQueryPort;
        this.sessionRepository = sessionRepository;
        this.messageRepository = messageRepository;
        this.documentRepository = documentRepository;
        this.userRepository = userRepository;
    }

    @Transactional(readOnly = true)
    public List<ChatSession> sessionsFor(Long userId) {
        return sessionRepository.findByUser_UserIdOrderByCreatedAtDesc(userId);
    }

    /** Ownership-scoped: returns empty rather than another user's chat. */
    @Transactional(readOnly = true)
    public Optional<ChatSession> session(Long chatId, Long userId) {
        return sessionRepository.findByChatIdAndUser_UserId(chatId, userId);
    }

    @Transactional(readOnly = true)
    public List<ChatMessage> messages(Long chatId, Long userId) {
        return sessionRepository.findByChatIdAndUser_UserId(chatId, userId)
                .map(s -> messageRepository.findByChatSession_ChatIdOrderByCreatedAtAsc(chatId))
                .orElseGet(List::of);
    }

    public boolean isAiAvailable() {
        return aiQueryPort.isAvailable();
    }

    /**
     * The core flow: persist the question, ask the corpus, persist the answer.
     *
     * @param chatId existing session to continue, or null to start one
     * @return the persisted assistant message, citations included
     */
    @Transactional
    public ChatMessage ask(Long userId, Long chatId, String question) {
        String text = question == null ? "" : question.strip();
        if (text.isEmpty()) {
            throw new IllegalArgumentException("Question must not be empty.");
        }

        ChatSession session = resolveSession(userId, chatId, text);

        ChatMessage userMessage = new ChatMessage();
        userMessage.setChatSession(session);
        userMessage.setSender(SENDER_USER);
        userMessage.setMessage(text);
        userMessage.setCreatedAt(Instant.now());
        messageRepository.save(userMessage);

        RagAnswer answer = aiQueryPort.ask(text, null, null);

        if (answer.serviceUnavailable()) {
            log.warn("Assistant unavailable for chat {}: {}", session.getChatId(), answer.reason());
        } else if (answer.notFoundInCorpus()) {
            log.info("Not found in corpus for chat {}: {}", session.getChatId(), answer.reason());
        }

        ChatMessage reply = new ChatMessage();
        reply.setChatSession(session);
        reply.setSender(SENDER_ASSISTANT);
        reply.setMessage(answer.answer());
        // Only a genuine "the corpus does not cover this" sets the flag. An
        // outage must not be recorded as a statement about the corpus - the
        // question is unanswered, not answered in the negative.
        reply.setNotFoundInCorpus(answer.notFoundInCorpus() && !answer.serviceUnavailable());
        // The flag above cannot express the third outcome: an outage and an
        // answer the model chose not to cite both leave it false with no
        // citations. The chat view renders from persisted state, so the
        // distinction has to be stored, not inferred.
        reply.setDeliveryStatus(
                answer.serviceUnavailable() ? ChatMessage.DELIVERY_UNAVAILABLE
                        : answer.notFoundInCorpus() ? ChatMessage.DELIVERY_NOT_FOUND
                        : ChatMessage.DELIVERY_ANSWERED);
        reply.setCreatedAt(Instant.now());
        messageRepository.save(reply);

        persistCitations(reply, answer.citations());

        session.setMessageCount(session.getMessageCount() + 2);
        session.setLastMessageAt(Instant.now());
        sessionRepository.save(session);

        return reply;
    }

    private ChatSession resolveSession(Long userId, Long chatId, String firstQuestion) {
        if (chatId != null) {
            Optional<ChatSession> existing = sessionRepository.findByChatIdAndUser_UserId(chatId, userId);
            if (existing.isPresent()) {
                return existing.get();
            }
            // Not an error the user should see as a failure: start a new session
            // rather than losing the question. Logged because a mismatched id is
            // either a stale tab or someone probing another user's chats.
            log.warn("Chat {} not found for user {} - starting a new session", chatId, userId);
        }

        User user = userRepository.findById(userId).orElseThrow(
                () -> new IllegalStateException("No user with id " + userId));

        ChatSession session = new ChatSession();
        session.setUser(user);
        session.setTitle(titleFrom(firstQuestion));
        session.setCreatedAt(Instant.now());
        session.setMessageCount(0);
        return sessionRepository.save(session);
    }

    /**
     * Maps each citation onto a row, resolving {@code sourceDocumentId} to the entity.
     *
     * <p>Documents are looked up once per distinct id rather than per citation:
     * six citations from one book would otherwise be six identical selects.
     */
    private void persistCitations(ChatMessage message, List<RagCitation> citations) {
        if (citations.isEmpty()) {
            return;
        }

        Map<Long, SourceDocument> documents = new HashMap<>();
        for (RagCitation c : citations) {
            if (c.sourceDocumentId() != null) {
                documents.computeIfAbsent(c.sourceDocumentId(),
                        id -> documentRepository.findById(id).orElse(null));
            }
        }

        for (RagCitation c : citations) {
            ChatMessageCitation row = new ChatMessageCitation();
            row.setMessage(message);
            row.setPassageNo(c.passageNo());
            row.setChunkId(c.chunkId());
            row.setBookName(c.bookName());
            row.setPageNo(c.pageNo());
            row.setVerseNo(c.verseNo());
            row.setChunkIndex(c.chunkIndex());
            row.setSnippet(c.snippet());
            row.setScore(c.score());
            if (c.sourceDocumentId() != null) {
                // Null when the document was deleted after indexing. The FK is
                // nullable for exactly this case: the citation stays readable
                // through its denormalised book, page and snippet.
                row.setSourceDocument(documents.get(c.sourceDocumentId()));
            }
            message.getCitations().add(row);
        }
        // Cascade = ALL on ChatMessage.citations, so saving the parent writes them.
        messageRepository.save(message);
    }

    private static String titleFrom(String question) {
        String flat = question.replaceAll("\\s+", " ").strip();
        return flat.length() <= TITLE_MAX ? flat : flat.substring(0, TITLE_MAX - 1) + "…";
    }
}
