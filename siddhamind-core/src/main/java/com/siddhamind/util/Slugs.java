package com.siddhamind.util;

import java.text.Normalizer;
import java.util.Locale;

/**
 * Document-ID slugs.
 *
 * <p>Firestore has no auto-increment, so seeded records use a deterministic slug
 * derived from their English name. Re-running the seeder then overwrites rather
 * than duplicating.
 *
 * <p><b>Underscore is reserved.</b> Interaction documents are keyed
 * {@code {ingredientSlug}_{drugSlug}}, so a slug that contained an underscore
 * would make that key ambiguous. {@link #of} maps every non-alphanumeric
 * character to a hyphen, which keeps the split on {@code _} unambiguous.
 */
public final class Slugs {

    private Slugs() {}

    /**
     * {@code "Ayya Parpam (Iron Parpam)"} to {@code "ayya-parpam-iron-parpam"}.
     *
     * <p>Non-ASCII input (Tamil) is stripped by the diacritic pass, so callers
     * should slug the English name. Seed data always carries one.
     */
    public static String of(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("Cannot slug a blank value");
        }
        String ascii = Normalizer.normalize(raw, Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "");
        String slug = ascii.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        if (slug.isEmpty()) {
            throw new IllegalArgumentException("Value produced an empty slug: " + raw);
        }
        return slug;
    }

    /** Composite key for an interaction document. */
    public static String interactionId(String ingredientId, String drugId) {
        return ingredientId + "_" + drugId;
    }
}
