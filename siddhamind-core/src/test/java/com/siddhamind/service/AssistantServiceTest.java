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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AssistantServiceTest {

    @Mock AiQueryPort aiQueryPort;
    @Mock ChatSessionRepository sessionRepository;
    @Mock ChatMessageRepository messageRepository;
    @Mock SourceDocumentRepository documentRepository;
    @Mock UserRepository userRepository;

    AssistantService service;
    User user;

    private static final RagCitation CITATION = new RagCitation(
            1, 42L, 7L, "Synthetic Test Document", 1, "101", 1,
            "101. Thiripala Chooranam. Ingredients: Kadukkai 35 g...", 0.0328);

    @BeforeEach
    void setUp() {
        service = new AssistantService(aiQueryPort, sessionRepository, messageRepository,
                documentRepository, userRepository);

        user = new User();
        user.setUserId(3L);
        when(userRepository.findById(3L)).thenReturn(Optional.of(user));

        // save() returns its argument, and assigns an id for a new session.
        when(sessionRepository.save(any(ChatSession.class))).thenAnswer(inv -> {
            ChatSession s = inv.getArgument(0);
            if (s.getChatId() == null) {
                s.setChatId(100L);
            }
            return s;
        });
        when(messageRepository.save(any(ChatMessage.class))).thenAnswer(inv -> inv.getArgument(0));

        SourceDocument doc = new SourceDocument();
        doc.setDocId(7L);
        doc.setTitle("Synthetic Test Document");
        when(documentRepository.findById(7L)).thenReturn(Optional.of(doc));
    }

    private List<ChatMessage> savedMessages() {
        ArgumentCaptor<ChatMessage> captor = ArgumentCaptor.forClass(ChatMessage.class);
        verify(messageRepository, org.mockito.Mockito.atLeastOnce()).save(captor.capture());
        return captor.getAllValues();
    }

    // ------------------------------------------------------------------
    // happy path
    // ------------------------------------------------------------------

    @Test
    void persistsQuestionAnswerAndCitations() {
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "Kadukkai, Thandrikkai and Nellikkai [1].", List.of(CITATION),
                false, 6, "top similarity 0.81", false));

        ChatMessage reply = service.ask(3L, null, "What are the ingredients of Thiripala Chooranam?");

        assertEquals(AssistantService.SENDER_ASSISTANT, reply.getSender());
        assertEquals("Kadukkai, Thandrikkai and Nellikkai [1].", reply.getMessage());
        assertFalse(reply.isNotFoundInCorpus());

        List<ChatMessage> saved = savedMessages();
        ChatMessage question = saved.stream()
                .filter(m -> AssistantService.SENDER_USER.equals(m.getSender()))
                .findFirst().orElseThrow();
        assertEquals("What are the ingredients of Thiripala Chooranam?", question.getMessage());
    }

    @Test
    void citationFieldsAreCopiedOntoTheEntity() {
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "answer [1]", List.of(CITATION), false, 6, null, false));

        ChatMessage reply = service.ask(3L, null, "q");

        assertEquals(1, reply.getCitations().size());
        ChatMessageCitation c = reply.getCitations().get(0);
        assertEquals(1, c.getPassageNo());
        assertEquals(42L, c.getChunkId());
        assertEquals("Synthetic Test Document", c.getBookName());
        assertEquals(1, c.getPageNo());
        assertEquals("101", c.getVerseNo());
        assertEquals(1, c.getChunkIndex());
        assertEquals(0.0328, c.getScore(), 1e-9);
        assertTrue(c.getSnippet().startsWith("101. Thiripala"));
        assertNotNull(c.getSourceDocument(), "sourceDocumentId should resolve to the entity");
        assertEquals(7L, c.getSourceDocument().getDocId());
        assertEquals(reply, c.getMessage());
    }

    @Test
    void aDocumentIsLookedUpOncePerDistinctIdNotOncePerCitation() {
        RagCitation second = new RagCitation(2, 43L, 7L, "Synthetic Test Document",
                2, "102", 2, "snippet two", 0.02);
        RagCitation third = new RagCitation(3, 44L, 7L, "Synthetic Test Document",
                3, "103", 3, "snippet three", 0.01);
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "a [1][2][3]", List.of(CITATION, second, third), false, 6, null, false));

        service.ask(3L, null, "q");

        verify(documentRepository, times(1)).findById(7L);
    }

    @Test
    void aCitationWhoseDocumentWasDeletedStillPersists() {
        // The FK is nullable on purpose: re-ingesting or deleting a book must not
        // erase a past consultation's citation, which stays readable through its
        // denormalised book, page and snippet.
        when(documentRepository.findById(99L)).thenReturn(Optional.empty());
        RagCitation orphan = new RagCitation(1, 5L, 99L, "Deleted Book", 4, "9", 0,
                "text", 0.03);
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "a [1]", List.of(orphan), false, 1, null, false));

        ChatMessage reply = service.ask(3L, null, "q");

        assertEquals(1, reply.getCitations().size());
        assertNull(reply.getCitations().get(0).getSourceDocument());
        assertEquals("Deleted Book", reply.getCitations().get(0).getBookName());
    }

    @Test
    void sessionCountersAdvanceByTwo() {
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "a", List.of(), false, 1, null, false));

        ChatMessage reply = service.ask(3L, null, "q");

        ChatSession session = reply.getChatSession();
        assertEquals(2, session.getMessageCount(), "one question plus one answer");
        assertNotNull(session.getLastMessageAt());
    }

    @Test
    void theSessionTitleComesFromTheFirstQuestion() {
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "a", List.of(), false, 1, null, false));

        ChatMessage reply = service.ask(3L, null, "  What   is   the dose\nof Sukku Chooranam?  ");
        assertEquals("What is the dose of Sukku Chooranam?", reply.getChatSession().getTitle());
    }

    @Test
    void aLongQuestionIsTruncatedForTheTitle() {
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "a", List.of(), false, 1, null, false));

        String longQuestion = "word ".repeat(60);
        String title = service.ask(3L, null, longQuestion).getChatSession().getTitle();
        assertTrue(title.length() <= 80, "title was " + title.length() + " chars");
        assertTrue(title.endsWith("…"));
    }

    // ------------------------------------------------------------------
    // not found in corpus
    // ------------------------------------------------------------------

    @Test
    void notFoundInCorpusIsRecordedOnTheMessage() {
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "That is not covered by the indexed corpus.", List.of(), true, 6,
                "top similarity 0.11 is below the 0.35 floor", false));

        ChatMessage reply = service.ask(3L, null, "tyre pressure of a Boeing 737");

        assertTrue(reply.isNotFoundInCorpus());
        assertTrue(reply.getCitations().isEmpty(), "a refusal must carry no citations");
        assertTrue(reply.getMessage().contains("not covered"));
    }

    @Test
    void theQuestionIsStillPersistedWhenTheCorpusCannotAnswer() {
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "not covered", List.of(), true, 6, null, false));

        service.ask(3L, null, "unanswerable");

        assertTrue(savedMessages().stream()
                .anyMatch(m -> AssistantService.SENDER_USER.equals(m.getSender())
                        && "unanswerable".equals(m.getMessage())));
    }

    // ------------------------------------------------------------------
    // AI service down
    // ------------------------------------------------------------------

    @Test
    void anOutageStillPersistsTheQuestionAndAnExplanatoryReply() {
        when(aiQueryPort.ask(anyString(), any(), any()))
                .thenReturn(RagAnswer.unavailable("connection refused"));

        ChatMessage reply = service.ask(3L, null, "What is the dose of Sukku Chooranam?");

        List<ChatMessage> saved = savedMessages();
        assertTrue(saved.stream().anyMatch(m -> AssistantService.SENDER_USER.equals(m.getSender())),
                "the user's question must survive an outage");
        assertEquals(AssistantService.SENDER_ASSISTANT, reply.getSender());
        assertTrue(reply.getMessage().contains("temporarily unavailable"));
    }

    @Test
    void theThreeOutcomesArePersistedDistinguishably() {
        // The whole point of delivery_status. Without it an outage and an
        // uncited answer are identical rows, and the chat view - which renders
        // entirely from persisted state - cannot style them apart.
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "answer [1]", List.of(CITATION), false, 6, null, false));
        assertEquals(ChatMessage.DELIVERY_ANSWERED,
                service.ask(3L, null, "q").getDeliveryStatus());

        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "not covered", List.of(), true, 6, null, false));
        assertEquals(ChatMessage.DELIVERY_NOT_FOUND,
                service.ask(3L, null, "q").getDeliveryStatus());

        when(aiQueryPort.ask(anyString(), any(), any()))
                .thenReturn(RagAnswer.unavailable("connection refused"));
        assertEquals(ChatMessage.DELIVERY_UNAVAILABLE,
                service.ask(3L, null, "q").getDeliveryStatus());
    }

    @Test
    void anUncitedAnswerIsNotMistakenForAnOutage() {
        // Phase 5 permits the model to reply without brackets - e.g. "the
        // passages do not state a dose". That is an ANSWER, and it is the case
        // that made the old boolean ambiguous.
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "The passages do not state a dose.", List.of(), false, 6, null, false));

        ChatMessage reply = service.ask(3L, null, "q");

        assertEquals(ChatMessage.DELIVERY_ANSWERED, reply.getDeliveryStatus());
        assertFalse(reply.isUnavailable());
        assertTrue(reply.getCitations().isEmpty());
    }

    @Test
    void theUserMessageCarriesTheInertDefaultStatus() {
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "a", List.of(), false, 1, null, false));

        service.ask(3L, null, "q");

        ChatMessage question = savedMessages().stream()
                .filter(m -> AssistantService.SENDER_USER.equals(m.getSender()))
                .findFirst().orElseThrow();
        // NOT NULL column; USER rows have no outcome of their own.
        assertEquals(ChatMessage.DELIVERY_ANSWERED, question.getDeliveryStatus());
    }

    @Test
    void anOutageIsNotRecordedAsACorpusGap() {
        // The distinction that matters clinically. "The corpus does not cover
        // this" is a statement about the formulary; an outage is a statement
        // about the network. Flagging an outage as notFoundInCorpus would tell a
        // practitioner the texts are silent on something they may well describe.
        when(aiQueryPort.ask(anyString(), any(), any()))
                .thenReturn(RagAnswer.unavailable("read timed out"));

        ChatMessage reply = service.ask(3L, null, "q");

        assertFalse(reply.isNotFoundInCorpus());
        assertTrue(reply.getCitations().isEmpty());
    }

    @Test
    void theAdapterNeverThrowsSoAskDoesNotEither() {
        when(aiQueryPort.ask(anyString(), any(), any()))
                .thenReturn(RagAnswer.unavailable("anything"));

        assertNotNull(service.ask(3L, null, "q"));
    }

    // ------------------------------------------------------------------
    // sessions and ownership
    // ------------------------------------------------------------------

    @Test
    void continuesAnExistingSession() {
        ChatSession existing = new ChatSession();
        existing.setChatId(55L);
        existing.setUser(user);
        existing.setMessageCount(4);
        when(sessionRepository.findByChatIdAndUser_UserId(55L, 3L)).thenReturn(Optional.of(existing));
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "a", List.of(), false, 1, null, false));

        ChatMessage reply = service.ask(3L, 55L, "follow-up");

        assertEquals(55L, reply.getChatSession().getChatId());
        assertEquals(6, existing.getMessageCount());
        verify(userRepository, never()).findById(anyLong());
    }

    @Test
    void aChatIdBelongingToAnotherUserStartsAFreshSessionInsteadOfLeaking() {
        // findByChatIdAndUser_UserId returns empty for someone else's chat, so
        // the question goes to a new session of the caller's own rather than
        // being appended to - or worse, revealing - another user's conversation.
        when(sessionRepository.findByChatIdAndUser_UserId(999L, 3L)).thenReturn(Optional.empty());
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "a", List.of(), false, 1, null, false));

        ChatMessage reply = service.ask(3L, 999L, "q");

        assertEquals(100L, reply.getChatSession().getChatId(), "a new session, not 999");
        assertEquals(user, reply.getChatSession().getUser());
    }

    @Test
    void messagesAreScopedToTheOwner() {
        when(sessionRepository.findByChatIdAndUser_UserId(55L, 9L)).thenReturn(Optional.empty());

        assertTrue(service.messages(55L, 9L).isEmpty());
        verify(messageRepository, never()).findByChatSession_ChatIdOrderByCreatedAtAsc(anyLong());
    }

    @Test
    void messagesAreLoadedForTheOwner() {
        ChatSession owned = new ChatSession();
        owned.setChatId(55L);
        when(sessionRepository.findByChatIdAndUser_UserId(55L, 3L)).thenReturn(Optional.of(owned));
        when(messageRepository.findByChatSession_ChatIdOrderByCreatedAtAsc(55L))
                .thenReturn(List.of(new ChatMessage()));

        assertEquals(1, service.messages(55L, 3L).size());
    }

    // ------------------------------------------------------------------
    // input validation
    // ------------------------------------------------------------------

    @Test
    void anEmptyQuestionIsRejectedBeforeAnythingIsPersisted() {
        assertThrows(IllegalArgumentException.class, () -> service.ask(3L, null, "   "));
        assertThrows(IllegalArgumentException.class, () -> service.ask(3L, null, null));
        verify(messageRepository, never()).save(any());
        verify(aiQueryPort, never()).ask(anyString(), any(), any());
    }

    @Test
    void theQuestionIsTrimmedBeforeBeingSent() {
        when(aiQueryPort.ask(anyString(), any(), any())).thenReturn(new RagAnswer(
                "a", List.of(), false, 1, null, false));

        service.ask(3L, null, "   padded question   ");

        verify(aiQueryPort).ask(org.mockito.ArgumentMatchers.eq("padded question"), any(), any());
    }

    @Test
    void availabilityIsDelegatedToThePort() {
        when(aiQueryPort.isAvailable()).thenReturn(true);
        assertTrue(service.isAiAvailable());
    }
}
