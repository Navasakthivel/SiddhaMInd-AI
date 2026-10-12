package com.siddhamind.repository;

import com.siddhamind.entity.Ingredient;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface IngredientRepository extends JpaRepository<Ingredient, Long> {

    Optional<Ingredient> findBySlug(String slug);

    List<Ingredient> findByHeavyMetalTrueOrderByNameEnglishAsc();

    long countByHeavyMetalTrue();

    List<Ingredient> findAllByOrderByNameEnglishAsc();
}
