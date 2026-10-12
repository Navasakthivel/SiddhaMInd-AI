package com.siddhamind.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertFalse;

class SlugsTest {

    @Test
    void lowercasesAndHyphenates() {
        assertEquals("naga-parpam", Slugs.of("Naga Parpam"));
        assertEquals("crab-fossil", Slugs.of("Crab fossil"));
        assertEquals("king-of-bitters", Slugs.of("King of bitters"));
    }

    @Test
    void stripsPunctuationAndCollapsesSeparators() {
        assertEquals("ayya-parpam-iron-parpam", Slugs.of("Ayya Parpam (Iron Parpam)"));
        assertEquals("ilaippu-suvasakasam", Slugs.of("Ilaippu / Suvasakasam"));
        assertEquals("paediatric-age-below-12", Slugs.of("Paediatric age below 12"));
    }

    @Test
    void trimsLeadingAndTrailingSeparators() {
        assertEquals("pregnancy", Slugs.of("  Pregnancy!  "));
    }

    /**
     * The interaction document ID is {ingredient}_{drug}, so a slug containing an
     * underscore would make that key ambiguous.
     */
    @Test
    void neverProducesAnUnderscore() {
        assertFalse(Slugs.of("Chronic_kidney disease").contains("_"));
        assertEquals("chronic-kidney-disease", Slugs.of("Chronic_kidney disease"));
    }

    @Test
    void buildsCompositeInteractionId() {
        assertEquals("zinc_ciprofloxacin", Slugs.interactionId("zinc", "ciprofloxacin"));
        assertEquals("white-arsenic_warfarin", Slugs.interactionId("white-arsenic", "warfarin"));
    }

    @Test
    void rejectsBlankAndUnslugabbleInput() {
        assertThrows(IllegalArgumentException.class, () -> Slugs.of(null));
        assertThrows(IllegalArgumentException.class, () -> Slugs.of("   "));
        // Tamil-only input has no ASCII to keep - callers must slug the English name.
        assertThrows(IllegalArgumentException.class, () -> Slugs.of("நாக பற்பம்"));
    }
}
