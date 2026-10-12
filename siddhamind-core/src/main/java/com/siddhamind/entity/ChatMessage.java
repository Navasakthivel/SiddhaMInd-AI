package com.siddhamind.entity;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.ForeignKey;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "chat_messages")
public class ChatMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "message_id")
    private Long messageId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "chat_id", nullable = false,
            foreignKey = @ForeignKey(name = "fk_msg_chat"))
    private ChatSession chatSession;

    /** USER | ASSISTANT - also enforced by a CHECK constraint. */
    @Column(nullable = false, length = 20)
    private String sender;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String message;

    /** True when retrieval found nothing and the assistant declined to answer. */
    @Column(name = "not_found_in_corpus", nullable = false)
    private boolean notFoundInCorpus;

    /**
     * ANSWERED | NOT_FOUND | UNAVAILABLE - the reply's outcome, also enforced by
     * a CHECK constraint.
     *
     * <p>Exists because {@code notFoundInCorpus} could not express the third
     * case: an outage and a legitimately uncited answer both stored {@code false}
     * with no citations, so nothing survived to tell them apart once the row was
     * read back. The two mean opposite things to a practitioner - "the classical
     * texts do not cover this" versus "we never reached the assistant" - and the
     * chat view renders entirely from persisted state.
     *
     * <p>Inert for USER messages, which have no delivery outcome of their own.
     */
    @Column(name = "delivery_status", nullable = false, length = 20)
    private String deliveryStatus = DELIVERY_ANSWERED;

    public static final String DELIVERY_ANSWERED = "ANSWERED";
    public static final String DELIVERY_NOT_FOUND = "NOT_FOUND";
    public static final String DELIVERY_UNAVAILABLE = "UNAVAILABLE";

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @OneToMany(mappedBy = "message", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<ChatMessageCitation> citations = new ArrayList<>();

    public ChatMessage() {}

    public Long getMessageId() { return messageId; }
    public void setMessageId(Long messageId) { this.messageId = messageId; }

    public ChatSession getChatSession() { return chatSession; }
    public void setChatSession(ChatSession chatSession) { this.chatSession = chatSession; }

    public String getSender() { return sender; }
    public void setSender(String sender) { this.sender = sender; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }

    public boolean isNotFoundInCorpus() { return notFoundInCorpus; }
    public void setNotFoundInCorpus(boolean notFoundInCorpus) { this.notFoundInCorpus = notFoundInCorpus; }

    public String getDeliveryStatus() { return deliveryStatus; }
    public void setDeliveryStatus(String deliveryStatus) { this.deliveryStatus = deliveryStatus; }

    /* Convenience predicates so templates ask a question rather than compare
       string literals - a typo in th:if silently renders nothing. */
    public boolean isUnavailable() { return DELIVERY_UNAVAILABLE.equals(deliveryStatus); }
    public boolean isNotFound() { return DELIVERY_NOT_FOUND.equals(deliveryStatus); }
    public boolean isAnswered() { return DELIVERY_ANSWERED.equals(deliveryStatus); }
    public boolean isFromUser() { return "USER".equals(sender); }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }

    public List<ChatMessageCitation> getCitations() { return citations; }
    public void setCitations(List<ChatMessageCitation> citations) { this.citations = citations; }
}
