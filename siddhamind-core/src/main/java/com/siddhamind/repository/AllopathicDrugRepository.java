package com.siddhamind.repository;

import com.siddhamind.entity.AllopathicDrug;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface AllopathicDrugRepository extends JpaRepository<AllopathicDrug, Long> {

    Optional<AllopathicDrug> findBySlug(String slug);

    /** Matches the stored lowercase column, which is indexed. */
    Optional<AllopathicDrug> findByDrugNameLower(String drugNameLower);
}
