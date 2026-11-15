# Workout history import

JIEN accepts the original workout-history CSV exported by Hevy or Strong. Open
**Settings → Data → Import workout history**, choose the CSV, then review the detected
source, workout and set totals, date range, and exercise matches before confirming.

Exact exercise-name matches use the existing JIEN catalogue. Every unmatched name can
be mapped to an existing exercise or created as a private custom exercise. Newly created
exercises start in the `other` muscle group; review their muscle and rep-range targets
after import so progression guidance is categorized precisely.

The CSV is parsed on-device. Confirming the preview writes all new workouts in one local
SQLite transaction and queues their records for account sync. Imported workouts use
device-scoped stable IDs derived from their source rows, so importing the same file again
skips the existing sessions instead of creating duplicates. Source load units are retained and the
progression engine normalizes pounds to kilograms only when calculating volume. Warm-up
sets remain in history and are excluded from working-volume calculations.

Unknown CSV layouts and malformed dates or weights are rejected before any records are
written. JIEN does not upload the CSV itself.
