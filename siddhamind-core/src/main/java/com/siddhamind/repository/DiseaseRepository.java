package com.siddhamind.repository;

import com.siddhamind.entity.Disease;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface DiseaseRepository extends JpaRepository<Disease, Long> {

    Optional<Disease> findBySlug(String slug);

    List<Disease> findByMukkutramType(String mukkutramType);

    List<Disease> findAllByOrderByNoiEnglishAsc();

    /**
     * The diagnosis engine's candidate set: diseases of the dominant kutram plus the
     * MIXED ones, ordered deterministically.
     *
     * <p>The Firestore version needed two queries and an in-memory sort, and the
     * relational version before it took whatever row the database returned first.
     * Sorting in SQL makes the "predicted disease" stable for identical inputs -
     * exact kutram matches first, then alphabetically.
     */
    @Query("""
            SELECT d FROM Disease d
            WHERE d.mukkutramType = :dominant OR d.mukkutramType = 'MIXED'
            ORDER BY CASE WHEN d.mukkutramType = :dominant THEN 0 ELSE 1 END,
                     d.noiEnglish ASC
            """)
    List<Disease> findCandidatesFor(@Param("dominant") String dominantKutram);

    /**
     * How many preparations are indicated for each disease, in ONE query.
     *
     * <p>The obvious alternative - asking per disease while rendering the list -
     * is N+1: thirteen diseases become fourteen round trips to Supabase, over a
     * transaction pooler, for a number shown on a card. This groups in the
     * database and returns only the pairs that have a count; a disease with no
     * indicated preparation simply does not appear, and the caller reads it as
     * zero.
     *
     * <p>Returns rows of [diseaseId, count] rather than a projection interface
     * because the caller turns them straight into a Map.
     */
    @Query("""
            SELECT fd.disease.diseaseId, COUNT(fd.fdId)
            FROM FormulationDisease fd
            GROUP BY fd.disease.diseaseId
            """)
    List<Object[]> countFormulationsPerDisease();

    /**
     * The diseases a formulation is classically indicated for.
     *
     * <p>A separate query rather than walking {@code Formulation.getIndications()}:
     * that association is LAZY and {@code spring.jpa.open-in-view} is false, so
     * dereferencing it in a controller throws once the transaction has closed.
     * One extra round trip beats a LazyInitializationException on a detail page.
     */
    @Query("""
            SELECT fd.disease FROM FormulationDisease fd
            WHERE fd.formulation.formId = :formId
            ORDER BY fd.disease.noiEnglish ASC
            """)
    List<Disease> findIndicatedFor(@Param("formId") Long formId);
}
