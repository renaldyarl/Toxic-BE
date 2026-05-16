import { THRESHOLDS } from '../config.js';
import type { SensorReading, Alert } from '../types/index.js';

const SENSOR_PARAMS = [
  'ph',
  'water_temperature',
  'dissolved_oxygen',
  'turbidity_ntu',
  'ec_us_cm',
  'tds_ppm',
  'orp_mv',
] as const;

type SensorParam = typeof SENSOR_PARAMS[number];

export function checkThresholds(reading: SensorReading): Omit<Alert, 'id' | 'created_at'>[] {
  const violations: Omit<Alert, 'id' | 'created_at'>[] = [];

  for (const param of SENSOR_PARAMS) {
    const value = reading[param as keyof SensorReading] as number | null;
    if (value === null || value === undefined) continue;

    const threshold = THRESHOLDS[param];
    if (!threshold) continue;

    const { min, max } = threshold;

    if (min !== null && value < min) {
      violations.push({
        reading_id:    reading.id,
        parameter:     param,
        value,
        threshold_min: min,
        threshold_max: max,
        message:       `${formatParam(param)} is ${value.toFixed(2)}, below minimum threshold of ${min}`,
        is_acknowledged: false,
      });
    } else if (max !== null && value > max) {
      violations.push({
        reading_id:    reading.id,
        parameter:     param,
        value,
        threshold_min: min,
        threshold_max: max,
        message:       `${formatParam(param)} is ${value.toFixed(2)}, above maximum threshold of ${max}`,
        is_acknowledged: false,
      });
    }
  }

  return violations;
}

function formatParam(param: SensorParam): string {
  const labels: Record<SensorParam, string> = {
    ph:                'pH',
    water_temperature: 'Water Temperature (°C)',
    dissolved_oxygen:  'Dissolved Oxygen (mg/L)',
    turbidity_ntu:     'Turbidity (NTU)',
    ec_us_cm:          'Electrical Conductivity (µS/cm)',
    tds_ppm:           'Total Dissolved Solids (PPM)',
    orp_mv:            'ORP (mV)',
  };
  return labels[param] ?? param;
}
