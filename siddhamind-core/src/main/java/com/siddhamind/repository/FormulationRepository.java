package com.siddhamind.repository;

import com.siddhamind.entity.Formulation;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface FormulationRepository extends JpaRepository<Formulation, Long> {

    Optional<Formulation> findBySlug(String slug);

    List<Formulation> findAllByOrderByNameEnglishAsc();

    long countByContainsHeavyMetalTrue();

    /**
     * Detail page in one round trip.
     *
     * <p>Only the composition is join-fetched. Fetching indications and
     * contraindications in the same query would produce a cartesian product across
     * three collections - Hibernate allows at most one fetched List per query
     * without pagination breaking. The other two load on access within the same
     * transaction.
     */
    @EntityGraph(attributePaths = {"ingredients", "ingredients.ingredient"})
    @Query("SELECT f FROM Formulation f WHERE f.formId = :id")
    Optional<Formulation> findDetailById(@Param("id") Long id);

    /**
     * Substring search across the English name, Tamil name and SFI code.
     *
     * <p>The Firestore version had to read the entire collection and filter in
     * memory because it had no substring operator. Postgres does this in the
     * database; the LOWER(name_english) index backs the English half, and the Tamil
     * and code columns are small enough to scan.
     */
    @Query("""
            SELECT f FROM Formulation f
            WHERE LOWER(f.nameEnglish) LIKE LOWER(CONCAT('%', :term, '%'))
               OR f.nameTamil LIKE CONCAT('%', :term, '%')
               OR LOWER(f.sfiCode) LIKE LOWER(CONCAT('%', :term, '%'))
            ORDER BY f.nameEnglish ASC
            """)
    List<Formulation> search(@Param("term") String term);

    /** Formulations indicated for a disease - the diagnosis engine's reverse lookup. */
    @Query("""
            SELECT DISTINCT f FROM Formulation f
            JOIN f.indications i
            WHERE i.disease.diseaseId = :diseaseId
            ORDER BY f.nameEnglish ASC
            """)
    List<Formulation> findByDiseaseId(@Param("diseaseId") Long diseaseId);

    /** Formulations indicated for any of a set of diseases, used to build suggestions. */
    @Query("""
            SELECT DISTINCT f FROM Formulation f
            JOIN f.indications i
            WHERE i.disease.diseaseId IN :diseaseIds
            ORDER BY f.nameEnglish ASC
            """)
    List<Formulation> findByDiseaseIds(@Param("diseaseIds") List<Long> diseaseIds);

    @Query("""
            SELECT DISTINCT f FROM Formulation f
            JOIN f.ingredients fi
            WHERE fi.ingredient.ingredientId = :ingredientId
            ORDER BY f.nameEnglish ASC
            """)
    List<Formulation> findByIngredientId(@Param("ingredientId") Long ingredientId);
}
