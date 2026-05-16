import { getDb } from '../db/index.js';
import { alerts } from '../db/schema.js';
import type { SensorReading, Alert } from '../types/index.js';
import { checkThresholds } from './threshold.js';

export async function processAlerts(
  reading: SensorReading,
  emitFn: (alert: Alert) => void
): Promise<Alert[]> {
  const violations = checkThresholds(reading);
  if (violations.length === 0) return [];

  const db = getDb();
  const inserted = await db
    .insert(alerts)
    .values(violations)
    .returning();

  const result: Alert[] = inserted.map((row) => ({
    id:              row.id,
    reading_id:      row.reading_id,
    parameter:       row.parameter,
    value:           row.value,
    threshold_min:   row.threshold_min ?? null,
    threshold_max:   row.threshold_max ?? null,
    message:         row.message,
    created_at:      row.created_at instanceof Date
                       ? row.created_at.toISOString()
                       : String(row.created_at),
    is_acknowledged: row.is_acknowledged,
  }));

  for (const alert of result) {
    emitFn(alert);
  }

  return result;
}
