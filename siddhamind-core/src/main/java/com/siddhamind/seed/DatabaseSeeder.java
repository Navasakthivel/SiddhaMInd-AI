package com.siddhamind.seed;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.siddhamind.entity.AllopathicDrug;
import com.siddhamind.entity.Disease;
import com.siddhamind.entity.Formulation;
import com.siddhamind.entity.Ingredient;
import com.siddhamind.entity.Interaction;
import com.siddhamind.entity.Notification;
import com.siddhamind.entity.Role;
import com.siddhamind.entity.SourceDocument;
import com.siddhamind.entity.User;
import com.siddhamind.repository.AllopathicDrugRepository;
import com.siddhamind.repository.DiseaseRepository;
import com.siddhamind.repository.FormulationRepository;
import com.siddhamind.repository.IngredientRepository;
import com.siddhamind.repository.InteractionRepository;
import com.siddhamind.repository.NotificationRepository;
import com.siddhamind.repository.RoleRepository;
import com.siddhamind.repository.SourceDocumentRepository;
import com.siddhamind.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Loads {@code seed/seed-data.json}. The equivalent of the original {@code data.sql},
 * which Hibernate ran on every boot.
 *
 * <p>Idempotent by natural key: every reference record is looked up by its slug and
 * updated in place, so re-running produces the same database rather than a duplicate
 * set. That is what the {@code slug} unique constraint on each reference table is for
 * - Postgres assigns the surrogate IDs, so the seed file cannot hard-code them.
 *
 * <p>References are resolved through slug-to-entity maps built as the run proceeds,
 * and the whole thing is one transaction: a broken reference aborts before anything
 * is committed, rather than leaving a formulation whose ingredient list is missing
 * the heavy metal.
 */
@Component
public class DatabaseSeeder {

    private static final Logger log = LoggerFactory.getLogger(DatabaseSeeder.class);

    private final SeedProperties props;
    private final ObjectMapper objectMapper;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    private final RoleRepository roleRepository;
    private final UserRepository userRepository;
    private final IngredientRepository ingredientRepository;
    private final DiseaseRepository diseaseRepository;
    private final AllopathicDrugRepository drugRepository;
    private final FormulationRepository formulationRepository;
    private final InteractionRepository interactionRepository;
    private final SourceDocumentRepository sourceDocumentRepository;
    private final NotificationRepository notificationRepository;

    public DatabaseSeeder(SeedProperties props, ObjectMapper objectMapper,
                          RoleRepository roleRepository, UserRepository userRepository,
                          IngredientRepository ingredientRepository, DiseaseRepository diseaseRepository,
                          AllopathicDrugRepository drugRepository,
                          FormulationRepository formulationRepository,
                          InteractionRepository interactionRepository,
                          SourceDocumentRepository sourceDocumentRepository,
                          NotificationRepository notificationRepository) {
        this.props = props;
        this.objectMapper = objectMapper;
        this.roleRepository = roleRepository;
        this.userRepository = userRepository;
        this.ingredientRepository = ingredientRepository;
        this.diseaseRepository = diseaseRepository;
        this.drugRepository = drugRepository;
        this.formulationRepository = formulationRepository;
        this.interactionRepository = interactionRepository;
        this.sourceDocumentRepository = sourceDocumentRepository;
        this.notificationRepository = notificationRepository;
    }

    @Transactional
    public SeedReport seed() {
        SeedData data = load();
        validate(data);

        if (!props.isForce() && formulationRepository.count() > 0) {
            long existing = formulationRepository.count();
            log.warn("Skipping seed: formulations already holds {} rows. "
                    + "Set siddhamind.seed.force=true to overwrite.", existing);
            return SeedReport.skipped(existing);
        }

        SeedReport report = new SeedReport();

        // --- roles ---
        Map<String, Role> roles = new HashMap<>();
        for (SeedData.RoleSeed r : data.roles()) {
            Role role = roleRepository.findByRoleName(r.roleName()).orElseGet(Role::new);
            role.setRoleName(r.roleName());
            role.setDescription(r.description());
            roles.put(r.id(), roleRepository.save(role));
            report.roles++;
        }

        // --- users ---
        Map<String, User> users = new HashMap<>();
        for (SeedData.UserSeed u : data.users()) {
            String email = u.email().toLowerCase(Locale.ROOT).trim();
            User user = userRepository.findByEmail(email).orElseGet(User::new);
            user.setFullName(u.fullName());
            user.setEmail(email);
            user.setPasswordHash(encoder.encode(u.password()));
            user.setPhone(u.phone());
            user.setRole(roles.get(u.roleId()));
            user.setRegNumber(u.regNumber());
            user.setInstitution(u.institution());
            user.setStatus(u.status() == null ? "ACTIVE" : u.status());
            // On a fresh database V5 runs before this and finds no demo rows to
            // label, so the IDs are assigned here too. V5 reserves 0001 in both
            // sequences, so admin-created accounts start at 0002 either way.
            user.setLoginId(u.loginId());
            user.setMustSetPassword(false);
            user.setActivationCodeHash(null);
            user.setActivationExpiresAt(null);
            users.put(u.id(), userRepository.save(user));
            report.users++;
        }

        // --- ingredients ---
        Map<String, Ingredient> ingredients = new HashMap<>();
        for (SeedData.IngredientSeed i : data.ingredients()) {
            Ingredient ing = ingredientRepository.findBySlug(i.id()).orElseGet(Ingredient::new);
            ing.setSlug(i.id());
            ing.setNameTamil(i.nameTamil());
            ing.setNameEnglish(i.nameEnglish());
            ing.setScientificName(i.scientificName());
            ing.setSourceType(i.sourceType());
            ing.setPartUsed(i.partUsed());
            ing.setSutthiRequired(Boolean.TRUE.equals(i.sutthiRequired()));
            ing.setHeavyMetal(Boolean.TRUE.equals(i.heavyMetal()));
            ing.setElementSymbol(i.elementSymbol());
            ing.setToxicityClass(i.toxicityClass());
            ing.setMaxDailyMg(i.maxDailyMg());
            ing.setNotes(i.notes());
            ingredients.put(i.id(), ingredientRepository.save(ing));
            report.ingredients++;
        }

        // --- diseases ---
        Map<String, Disease> diseases = new HashMap<>();
        for (SeedData.DiseaseSeed d : data.diseases()) {
            Disease disease = diseaseRepository.findBySlug(d.id()).orElseGet(Disease::new);
            disease.setSlug(d.id());
            disease.setNoiTamil(d.noiTamil());
            disease.setNoiEnglish(d.noiEnglish());
            disease.setModernEquivalent(d.modernEquivalent());
            disease.setMukkutramType(d.mukkutramType());
            disease.setDescription(d.description());
            diseases.put(d.id(), diseaseRepository.save(disease));
            report.diseases++;
        }

        // --- allopathic drugs ---
        Map<String, AllopathicDrug> drugs = new HashMap<>();
        for (SeedData.DrugSeed d : data.allopathicDrugs()) {
            AllopathicDrug drug = drugRepository.findBySlug(d.id()).orElseGet(AllopathicDrug::new);
            drug.setSlug(d.id());
            drug.setDrugName(d.drugName());   // also populates drugNameLower
            drug.setDrugClass(d.drugClass());
            drug.setCommonBrand(d.commonBrand());
            drug.setNotes(d.notes());
            drugs.put(d.id(), drugRepository.save(drug));
            report.drugs++;
        }

        // --- formulations, with composition, indications and contraindications ---
        for (SeedData.FormulationSeed f : data.formulations()) {
            Formulation form = formulationRepository.findBySlug(f.id()).orElseGet(Formulation::new);
            form.setSlug(f.id());
            form.setNameTamil(f.nameTamil());
            form.setNameEnglish(f.nameEnglish());
            form.setSfiCode(f.sfiCode());
            form.setDosageForm(f.dosageForm());
            form.setSourceBook(f.sourceBook());
            form.setPageNo(f.pageNo());
            form.setVerseNo(f.verseNo());
            form.setPreparationMethod(f.preparationMethod());
            form.setDose(f.dose());
            form.setAnupanam(f.anupanam());
            form.setShelfLife(f.shelfLife());
            form.setContainsHeavyMetal(Boolean.TRUE.equals(f.containsHeavyMetal()));
            form.setSafetyClass(f.safetyClass());

            // orphanRemoval on the three collections means clearing and rebuilding
            // deletes the old child rows rather than leaving them behind.
            form.getIngredients().clear();
            for (SeedData.FormulationIngredientSeed fi : nullSafe(f.ingredients())) {
                form.addIngredient(ingredients.get(fi.ingredientId()), fi.quantity(), fi.sutthiNote());
            }
            form.getIndications().clear();
            for (SeedData.IndicatedDiseaseSeed d : nullSafe(f.indicatedDiseases())) {
                form.addIndication(diseases.get(d.diseaseId()), d.evidenceNote());
            }
            form.getContraindications().clear();
            for (SeedData.ContraindicationSeed c : nullSafe(f.contraindications())) {
                form.addContraindication(c.conditionName(), c.severity(), c.note());
                report.contraindications++;
            }

            formulationRepository.save(form);
            report.formulations++;
        }

        // --- interactions ---
        for (SeedData.InteractionSeed ix : data.interactions()) {
            Ingredient ingredient = ingredients.get(ix.ingredientId());
            AllopathicDrug drug = drugs.get(ix.drugId());
            Interaction interaction = interactionRepository
                    .findByIngredient_IngredientIdAndDrug_DrugId(
                            ingredient.getIngredientId(), drug.getDrugId())
                    .orElseGet(Interaction::new);
            interaction.setIngredient(ingredient);
            interaction.setDrug(drug);
            interaction.setSeverity(ix.severity());
            interaction.setMechanism(ix.mechanism());
            interaction.setAdvice(ix.advice());
            interactionRepository.save(interaction);
            report.interactions++;
        }

        // --- source documents ---
        for (SeedData.SourceDocumentSeed s : data.sourceDocuments()) {
            SourceDocument doc = sourceDocumentRepository.findBySlug(s.id())
                    .orElseGet(SourceDocument::new);
            doc.setSlug(s.id());
            doc.setTitle(s.title());
            doc.setAuthor(s.author());
            doc.setBookCode(s.bookCode());
            doc.setLanguage(s.language());
            doc.setTotalPages(s.totalPages());
            doc.setFilePath(s.filePath());
            doc.setUploadedBy(users.get(s.uploadedBy()));
            // Ingestion state is left alone on re-seed - re-running the seeder must
            // not mark an already-indexed corpus as pending.
            if (doc.getDocId() == null) {
                doc.setIndexed(false);
                doc.setChunkCount(0);
                doc.setIngestStatus("PENDING");
            }
            sourceDocumentRepository.save(doc);
            report.sourceDocuments++;
        }

        // --- notifications ---
        for (SeedData.NotificationSeed n : data.notifications()) {
            Notification notif = new Notification();
            notif.setUser(users.get(n.userId()));
            notif.setTitle(n.title());
            notif.setMessage(n.message());
            notif.setRead(false);
            notificationRepository.save(notif);
            report.notifications++;
        }

        log.info("Seed complete: {}", report);
        return report;
    }

    // ---------- helpers ----------

    private SeedData load() {
        try (InputStream in = new ClassPathResource(props.getLocation()).getInputStream()) {
            return objectMapper.readValue(in, SeedData.class);
        } catch (Exception e) {
            throw new IllegalStateException("Could not read seed file " + props.getLocation(), e);
        }
    }

    /**
     * Fails the whole run on the first dangling reference.
     *
     * <p>The database's foreign keys would also reject these, but catching them here
     * names the offending key instead of surfacing a constraint violation.
     */
    static void validate(SeedData data) {
        Set<String> ingredientIds = ids(data.ingredients(), SeedData.IngredientSeed::id);
        Set<String> diseaseIds = ids(data.diseases(), SeedData.DiseaseSeed::id);
        Set<String> drugIds = ids(data.allopathicDrugs(), SeedData.DrugSeed::id);
        Set<String> roleIds = ids(data.roles(), SeedData.RoleSeed::id);
        Set<String> userIds = ids(data.users(), SeedData.UserSeed::id);

        List<String> errors = new ArrayList<>();

        for (SeedData.UserSeed u : data.users()) {
            if (!roleIds.contains(u.roleId())) {
                errors.add("user '" + u.id() + "' references unknown role '" + u.roleId() + "'");
            }
        }
        for (SeedData.FormulationSeed f : data.formulations()) {
            for (SeedData.FormulationIngredientSeed fi : nullSafe(f.ingredients())) {
                if (!ingredientIds.contains(fi.ingredientId())) {
                    errors.add("formulation '" + f.id() + "' references unknown ingredient '"
                            + fi.ingredientId() + "'");
                }
            }
            for (SeedData.IndicatedDiseaseSeed d : nullSafe(f.indicatedDiseases())) {
                if (!diseaseIds.contains(d.diseaseId())) {
                    errors.add("formulation '" + f.id() + "' references unknown disease '"
                            + d.diseaseId() + "'");
                }
            }
        }
        for (SeedData.InteractionSeed ix : data.interactions()) {
            if (!ingredientIds.contains(ix.ingredientId())) {
                errors.add("interaction references unknown ingredient '" + ix.ingredientId() + "'");
            }
            if (!drugIds.contains(ix.drugId())) {
                errors.add("interaction references unknown drug '" + ix.drugId() + "'");
            }
        }
        for (SeedData.NotificationSeed n : data.notifications()) {
            if (!userIds.contains(n.userId())) {
                errors.add("notification references unknown user '" + n.userId() + "'");
            }
        }
        for (SeedData.SourceDocumentSeed s : data.sourceDocuments()) {
            if (s.uploadedBy() != null && !userIds.contains(s.uploadedBy())) {
                errors.add("source document '" + s.id() + "' references unknown user '"
                        + s.uploadedBy() + "'");
            }
        }

        if (!errors.isEmpty()) {
            throw new IllegalStateException("Seed data is inconsistent:\n  - "
                    + String.join("\n  - ", errors));
        }
    }

    private static <T> Set<String> ids(List<T> items, Function<T, String> idOf) {
        Set<String> out = new LinkedHashSet<>();
        for (T item : nullSafe(items)) {
            if (!out.add(idOf.apply(item))) {
                throw new IllegalStateException("Duplicate seed id: " + idOf.apply(item));
            }
        }
        return out;
    }

    private static <T> List<T> nullSafe(List<T> list) {
        return list == null ? List.of() : list;
    }

    /** Counts written per table. */
    public static class SeedReport {
        public int roles, users, ingredients, diseases, drugs, formulations,
                contraindications, interactions, sourceDocuments, notifications;
        public boolean skipped;
        public long existingFormulations;

        static SeedReport skipped(long existing) {
            SeedReport r = new SeedReport();
            r.skipped = true;
            r.existingFormulations = existing;
            return r;
        }

        @Override
        public String toString() {
            if (skipped) {
                return "SKIPPED (formulations already has " + existingFormulations + " rows)";
            }
            return roles + " roles, " + users + " users, " + ingredients + " ingredients, "
                    + diseases + " diseases, " + drugs + " drugs, " + formulations + " formulations, "
                    + contraindications + " contraindications, " + interactions + " interactions, "
                    + sourceDocuments + " source documents, " + notifications + " notifications";
        }
    }
}
