package com.siddhamind.repository;

import com.siddhamind.entity.Interaction;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface InteractionRepository extends JpaRepository<Interaction, Long> {

    /**
     * One row at most - guaranteed by the unique constraint on the pair, which
     * carries over what the Firestore composite document ID gave for free.
     */
    Optional<Interaction> findByIngredient_IngredientIdAndDrug_DrugId(Long ingredientId, Long drugId);

    /**
     * Every interaction between a formulation's ingredients and a set of drugs, in
     * one query.
     *
     * <p>The Firestore version issued one point read per ingredient-drug pair, so an
     * N-ingredient by M-drug check cost N*M round trips. A join does it in one.
     */
    @Query("""
            SELECT i FROM Interaction i
            WHERE i.ingredient.ingredientId IN :ingredientIds
              AND i.drug.drugId IN :drugIds
            """)
    List<Interaction> findByIngredientsAndDrugs(@Param("ingredientIds") List<Long> ingredientIds,
                                                @Param("drugIds") List<Long> drugIds);

    List<Interaction> findByIngredient_IngredientId(Long ingredientId);

    List<Interaction> findByDrug_DrugId(Long drugId);
}
