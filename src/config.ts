import type { ThresholdConfig } from './types/index.js';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export function loadConfig() {
  return {
    databaseUrl: requireEnv('DATABASE_URL'),
    jwtSecret: requireEnv('JWT_SECRET'),
    deviceSecret: requireEnv('DEVICE_SECRET'),
    adminEmail: process.env['ADMIN_EMAIL'] ?? 'admin@example.com',
    adminPassword: process.env['ADMIN_PASSWORD'] ?? 'changeme',
    port: parseInt(process.env['PORT'] ?? '3001', 10),
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    allowedOrigin: process.env['ALLOWED_ORIGIN'] ?? 'http://localhost:3000',
  };
}

export type Config = ReturnType<typeof loadConfig>;

export const THRESHOLDS: Record<string, ThresholdConfig> = {
  ph:                { min: 6.5,  max: 8.5  },
  water_temperature: { min: 20,   max: 30   },
  dissolved_oxygen:  { min: 4,    max: null },
  turbidity_ntu:     { min: null, max: 5    },
  ec_us_cm:          { min: null, max: 500  },
  tds_ppm:           { min: null, max: 500  },
  orp_mv:            { min: 100,  max: 500  },
};

export const JWT_EXPIRES_IN = '7d';
export const JWT_EXPIRES_SECONDS = 7 * 24 * 60 * 60;
