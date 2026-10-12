package com.siddhamind.service;

import com.siddhamind.dto.Finding;
import com.siddhamind.dto.SafetyVerdict;
import com.siddhamind.entity.SafetyCheck;
import com.siddhamind.repository.FormulationRepository;
import com.siddhamind.repository.SafetyCheckRepository;
import com.siddhamind.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Writes the safety audit row in its own transaction.
 *
 * <p>A separate bean rather than a method on {@link SafetyService} for two reasons,
 * both of which would silently defeat the intent otherwise:
 *
 * <ul>
 *   <li>Spring's transactional proxy does not intercept self-invocation, so
 *       {@code REQUIRES_NEW} on a private or internal call is ignored entirely.</li>
 *   <li>Catching an exception inside the caller's transaction is not enough - the
 *       failed write has already marked that transaction rollback-only, so the
 *       caller would fail at commit even though it handled the error.</li>
 * </ul>
 *
 * <p>The point is that a failure to record the check must never prevent the
 * practitioner from seeing the verdict.
 */
@Component
public class SafetyAuditWriter {

    private static final Logger log = LoggerFactory.getLogger(SafetyAuditWriter.class);

    private final SafetyCheckRepository safetyCheckRepository;
    private final UserRepository userRepository;
    private final FormulationRepository formulationRepository;

    public SafetyAuditWriter(SafetyCheckRepository safetyCheckRepository,
                             UserRepository userRepository,
                             FormulationRepository formulationRepository) {
        this.safetyCheckRepository = safetyCheckRepository;
        this.userRepository = userRepository;
        this.formulationRepository = formulationRepository;
    }

    /** @return the new check ID, or null when the write failed. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Long write(SafetyVerdict verdict, Long formId, String drugsText,
                      String conditionsText, Long userId) {
        try {
            SafetyCheck record = new SafetyCheck();
            if (userId != null) {
                userRepository.findById(userId).ifPresent(record::setUser);
            }
            if (formId != null) {
                formulationRepository.findById(formId).ifPresent(record::setFormulation);
            }
            record.setFormulationName(verdict.formulationName());
            record.setDrugsEntered(drugsText);
            record.setConditionsEntered(conditionsText);
            record.setRiskLevel(verdict.riskLevel());
            record.setMajorCount(verdict.majorCount());
            record.setModerateCount(verdict.moderateCount());
            record.setMinorCount(verdict.minorCount());
            record.setHeavyMetalDailyLimitMg(verdict.heavyMetalDailyLimitMg());
            record.setUnmatchedDrugs(verdict.unmatchedDrugs().isEmpty()
                    ? null : String.join(", ", verdict.unmatchedDrugs()));

            // The original stored only riskLevel and rebuilt the detail on demand, so
            // an audit record could not show what was actually reported at the time.
            for (Finding f : verdict.findings()) {
                record.addFinding(f.subject(), f.type(), f.severity(), f.detail(), f.advice());
            }

            return safetyCheckRepository.save(record).getCheckId();
        } catch (Exception e) {
            log.error("Could not persist safety check for formulation {}: {}", formId, e.getMessage());
            return null;
        }
    }
}
