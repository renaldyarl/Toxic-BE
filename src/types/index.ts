export interface SensorReading {
  id: string;
  device_id: string;
  recorded_at: string;
  ph: number | null;
  water_temperature: number | null;
  dissolved_oxygen: number | null;
  turbidity_ntu: number | null;
  ec_us_cm: number | null;
  tds_ppm: number | null;
  orp_mv: number | null;
}

export interface Alert {
  id: string;
  reading_id: string;
  parameter: string;
  value: number;
  threshold_min: number | null;
  threshold_max: number | null;
  message: string;
  created_at: string;
  is_acknowledged: boolean;
}

export interface SensorUpdatePayload {
  reading: SensorReading;
  alerts: Alert[];
}

export interface ThresholdConfig {
  min: number | null;
  max: number | null;
}

export interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export interface Device {
  id:           string;
  device_id:    string;
  name:         string;
  location:     string;
  is_active:    boolean;
  last_seen_at: string | null;
  created_at:   string;
}
