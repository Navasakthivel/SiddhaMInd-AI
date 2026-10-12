package com.siddhamind.controller.api;

import com.siddhamind.entity.ChatMessage;
import com.siddhamind.entity.ChatSession;
import com.siddhamind.entity.ChatMessageCitation;
import com.siddhamind.service.AssistantService;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The assistant, proxied.
 *
 * <p>This endpoint exists because the browser cannot call siddhamind-ai directly.
 * Every route on that service is guarded by a shared internal token, and a token
 * shipped to a client is a token anyone can read out of devtools. Java holds it
 * and the client talks only to Java.
 *
 * <p>The three delivery states are kept distinct all the way to the wire, because
 * they mean different things to a practitioner:
 * <ul>
 *   <li>{@code cited} - the corpus answered, and the citations say from where.</li>
 *   <li>{@code notfound} - the corpus does not cover this. A correct, final
 *       answer, not a failure, and never dressed as one.</li>
 *   <li>{@code error} - the explainer itself was unreachable. Says nothing about
 *       what the texts do or do not contain.</li>
 * </ul>
 * Collapsing {@code notfound} into {@code error} would tell a practitioner the
 * texts are silent on something they may well describe.
 */
@RestController
@RequestMapping("/api/assistant")
public class AssistantApiController {

    private final AssistantService assistantService;

    public AssistantApiController(AssistantService assistantService) {
        this.assistantService = assistantService;
    }

    public record AskRequest(String question, Long chatId) {}

    @GetMapping("/status")
    public Map<String, Object> status() {
        return Map.of("aiAvailable", assistantService.isAiAvailable());
    }

    /** The caller's own chats. Never another user's - see AssistantService.sessionsFor. */
    @GetMapping("/chats")
    public ResponseEntity<?> chats(HttpSession session) {
        Long userId = (Long) session.getAttribute("userId");
        if (userId == null) {
            return ResponseEntity.status(401).body(Map.of("error", "Not signed in."));
        }
        List<Map<String, Object>> rows = assistantService.sessionsFor(userId).stream()
                .map(DashboardApiController::chatSummary)
                .toList();
        return ResponseEntity.ok(Map.of("total", rows.size(), "chats", rows));
    }

    /**
     * One conversation with its messages and citations.
     *
     * <p>404 both when the chat does not exist and when it belongs to someone else.
     * Distinguishing them would confirm the existence of another user's chat to
     * anyone walking the ids. A "not yours" and a "does not exist" have to be
     * indistinguishable, or the difference between them is the answer.
     */
    @GetMapping("/chats/{chatId}")
    public ResponseEntity<?> chat(@PathVariable Long chatId, HttpSession session) {
        Long userId = (Long) session.getAttribute("userId");
        if (userId == null) {
            return ResponseEntity.status(401).body(Map.of("error", "Not signed in."));
        }

        Optional<ChatSession> found = assistantService.session(chatId, userId);
        if (found.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("error", "No such conversation."));
        }

        List<Map<String, Object>> messages = new ArrayList<>();
        for (ChatMessage m : assistantService.messages(chatId, userId)) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("messageId", m.getMessageId());
            row.put("sender", m.getSender());
            row.put("body", m.getMessage());
            row.put("createdAt", m.getCreatedAt());
            // Same three-way split /ask returns, so a replayed conversation reads
            // exactly as it did live: an outage must not look like "not in corpus".
            row.put("status", m.isAnswered() ? "cited" : m.isNotFound() ? "notfound" : "error");
            row.put("citations", m.isAnswered() ? citations(m) : List.of());
            messages.add(row);
        }

        Map<String, Object> out = new LinkedHashMap<>(DashboardApiController.chatSummary(found.get()));
        out.put("messages", messages);
        return ResponseEntity.ok(out);
    }

    @PostMapping("/ask")
    public ResponseEntity<?> ask(@RequestBody AskRequest body, HttpSession session) {
        if (body == null || body.question() == null || body.question().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Enter a question first."));
        }
        Long userId = (Long) session.getAttribute("userId");

        ChatMessage reply = assistantService.ask(userId, body.chatId(), body.question());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("chatId", reply.getChatSession() == null ? null
                : reply.getChatSession().getChatId());
        out.put("messageId", reply.getMessageId());
        out.put("body", reply.getMessage());

        if (reply.isAnswered()) {
            out.put("status", "cited");
            out.put("citations", citations(reply));
        } else if (reply.isNotFound()) {
            // "searched" is what the static design shows under a not-found: the
            // books that were looked in. The citation list is empty by definition
            // here, so the books come from the session's own retrieval scope.
            out.put("status", "notfound");
            out.put("citations", List.of());
        } else {
            out.put("status", "error");
            out.put("citations", List.of());
        }
        return ResponseEntity.ok(out);
    }

    private static List<Map<String, Object>> citations(ChatMessage message) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (ChatMessageCitation c : message.getCitations()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("passageNo", c.getPassageNo());
            m.put("bookName", c.getBookName());
            m.put("pageNo", c.getPageNo());
            m.put("verseNo", c.getVerseNo());
            m.put("snippet", c.getSnippet());
            // score is deliberately NOT exposed. It is an RRF fusion rank, not a
            // confidence, and a number next to a citation reads as one.
            out.add(m);
        }
        return out;
    }
}
