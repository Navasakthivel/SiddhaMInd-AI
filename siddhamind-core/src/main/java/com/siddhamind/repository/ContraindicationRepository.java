package com.siddhamind.repository;

import com.siddhamind.entity.Contraindication;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface ContraindicationRepository extends JpaRepository<Contraindication, Long> {

    List<Contraindication> findByFormulation_FormId(Long formId);

    /**
     * Distinct condition names for the safety form's dropdown.
     *
     * <p>Firestore had to read every formulation's contraindication subcollection to
     * build this list - one query per formulation. Here it is a single DISTINCT.
     */
    @Query("SELECT DISTINCT c.conditionName FROM Contraindication c ORDER BY c.conditionName ASC")
    List<String> findDistinctConditionNames();
}
