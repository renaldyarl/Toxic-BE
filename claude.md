# claude.md — Lake Toxicity Monitoring System

**Project:** Lake Water Toxicity Monitoring — Backend  
**Stack:** Node.js · Fastify · TypeScript · Drizzle ORM · TimescaleDB · Socket.io  
**Role of Claude Code:** Backend developer assistant — writes code, suggests improvements, never touches version control.

---

## 🗂️ Project Structure

```
backend/
├── src/
│   ├── index.ts              # Entry point, Fastify bootstrap
│   ├── config.ts             # Env vars, threshold constants
│   ├── db/
│   │   ├── index.ts          # DB connection (postgres.js)
│   │   ├── schema.ts         # Drizzle schema definitions
│   │   └── migrate.ts        # Migration runner
│   ├── plugins/
│   │   ├── socket.ts         # Socket.io plugin
│   │   └── auth.ts           # JWT auth hook
│   ├── routes/
│   │   ├── auth.ts           # POST /api/auth/login
│   │   ├── sensor.ts         # POST /api/sensor/ingest
│   │   └── readings.ts       # GET history, stats, export, alerts
│   ├── services/
│   │   ├── threshold.ts      # Threshold evaluation logic
│   │   └── alert.ts          # Alert creation + Socket.io broadcast
│   └── types/
│       └── index.ts          # Shared TypeScript types
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 🔑 Core Domain

### Sensor Parameters & Thresholds

All thresholds are defined in `src/config.ts` as constants. Do **not** move them to the database unless the user explicitly requests a configurable-threshold feature.

| Parameter           | Field name          | Unit   | Min   | Max  |
|---------------------|---------------------|--------|-------|------|
| pH                  | `ph`                | —      | 6.5   | 8.5  |
| Water temperature   | `water_temperature` | °C     | 20    | 30   |
| Dissolved oxygen    | `dissolved_oxygen`  | mg/L   | 4     | —    |
| Turbidity           | `turbidity_ntu`     | NTU    | —     | 5    |
| Conductivity (EC)   | `ec_us_cm`          | µS/cm  | —     | 500  |
| TDS                 | `tds_ppm`           | PPM    | —     | 500  |
| ORP                 | `orp_mv`            | mV     | 100   | 500  |

### Data Flow

```
ESP32 → POST /api/sensor/ingest
          ↓
     Validate (Zod) + verify device secret
          ↓
     Save to sensor_readings (TimescaleDB hypertable)
          ↓
     Run threshold check → save alerts[]
          ↓
     Socket.io emit → sensor:update + alert:new
          ↓
     Return { success, reading_id, alerts_generated }
```

### Database Tables
- `sensor_readings` — time-series table (hypertable if TimescaleDB available)
- `alerts` — every threshold violation, with `is_acknowledged` flag
- `users` — single-row admin table for dashboard login

---

## 🚀 Available Scripts

```bash
npm run dev          # tsx watch — hot reload
npm run build        # tsc → dist/
npm run start        # node dist/index.js
npm run db:migrate   # run Drizzle migrations
npm run seed         # seed admin user + 48h of fake sensor data
```

---

## 🌐 API Reference

### Auth
| Method | Path               | Auth | Description            |
|--------|--------------------|------|------------------------|
| POST   | /api/auth/login    | ✗    | Returns JWT token      |

### Sensor
| Method | Path                    | Auth        | Description                          |
|--------|-------------------------|-------------|--------------------------------------|
| POST   | /api/sensor/ingest      | Device secret | Receive reading from ESP32         |

### Readings (all require JWT)
| Method | Path                    | Description                             |
|--------|-------------------------|-----------------------------------------|
| GET    | /api/readings/latest    | Most recent reading                     |
| GET    | /api/readings/history   | Paginated history (`from`, `to`, `limit`) |
| GET    | /api/readings/stats     | Min/avg/max per param (`period=24h\|7d\|30d`) |
| GET    | /api/readings/export    | CSV download (`from`, `to`)             |

### Alerts (require JWT)
| Method | Path                        | Description              |
|--------|-----------------------------|--------------------------|
| GET    | /api/alerts                 | List alerts with filter  |
| PATCH  | /api/alerts/:id/acknowledge | Mark alert as resolved   |

### System
| Method | Path    | Description                           |
|--------|---------|---------------------------------------|
| GET    | /health | DB connection status + uptime         |

---

## ⚙️ WebSocket Events

**Server → Client:**
- `sensor:update` — `{ reading: SensorReading, alerts: Alert[] }` — fires on every ingest
- `alert:new` — `Alert` — fires per individual new alert

**Client → Server:**
- `subscribe` — optional client identification

---

## 📋 Code Standards

### TypeScript
- Strict mode always on (`"strict": true` in tsconfig)
- Explicit return types on all service functions
- No `any` — use `unknown` and narrow properly
- Zod for all external input validation (routes, ingest body)

### Fastify Patterns
```ts
// Always use typed route schemas
fastify.post<{ Body: IngestBody }>('/ingest', {
  schema: { body: zodToJsonSchema(IngestSchema) }
}, handler)

// Register plugins with fastify-plugin to share decorations across scopes
import fp from 'fastify-plugin'
export default fp(async (fastify) => { ... })
```

### Error Handling
All errors must follow this shape — handled by the global error handler:
```json
{ "success": false, "error": "Human-readable message", "code": "ERROR_CODE" }
```

### Database Queries
- Use Drizzle ORM for all queries — no raw SQL unless absolutely necessary
- Always use `db.select().from(table).where(...)` pattern
- For time-range queries, always index on `recorded_at`

---

## 🔒 Security

- `POST /api/sensor/ingest` is NOT JWT-protected — secured by `device_secret` in body instead
- All other non-auth routes require `Authorization: Bearer <token>` header
- Rate limit on `/api/sensor/ingest`: 10 req/min per IP (fastify-rate-limit)
- Never log raw passwords or the full JWT token
- `DEVICE_SECRET`, `JWT_SECRET` must come from env vars — never hardcoded

---

## 🌍 Environment Variables

```env
DATABASE_URL=postgresql://user:password@localhost:5432/lake_toxicity
JWT_SECRET=change_me_to_something_long_and_random
DEVICE_SECRET=change_me_device_secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=changeme
PORT=3001
NODE_ENV=development
ALLOWED_ORIGIN=http://localhost:3000
```

---

## 🚫 Prohibited Operations

### ❌ Git & GitHub — NEVER touch these

Claude Code is **strictly prohibited** from performing any version control operations, including but not limited to:

- `git add`, `git commit`, `git push`, `git pull`
- Creating, renaming, or deleting branches
- Opening or closing pull requests
- Interacting with the GitHub API in any way
- Modifying `.gitignore` without explicit user request
- Running any deployment scripts that trigger a git operation

**Reason:** The user manages all version control decisions manually. Claude Code has no visibility into branching strategy, commit conventions, or deployment pipeline. Touching git without context causes irreversible damage.

If a task naturally leads to "then we should commit this", Claude Code must stop and say:
> "Code is ready. Commit and push whenever you're ready — I won't touch git."

---

## 💡 Proactive Suggestion Policy

Claude Code **must speak up** when a user's approach has a clearly better alternative. Do not silently implement a suboptimal solution just because the user asked for it.

**When to suggest:**
- The requested implementation has a known performance issue at scale
- There is a built-in Fastify/Drizzle/Node.js feature that replaces what the user is manually building
- The proposed database schema will cause query problems later (e.g. missing index on `recorded_at`)
- Security risk is introduced (e.g. device secret passed as query param instead of body)
- The user's naming or structure will conflict with existing code

**How to suggest:**
Always implement what was asked first, then add a clearly labeled suggestion block:

```
✅ Done — [brief description of what was built]

💡 Suggestion: [what could be better and why]
   If you want, I can refactor this to [alternative approach].
   The benefit is [concrete reason — performance / security / maintainability].
```

Do not lecture or repeat suggestions the user has already declined.

---

## 📌 Development Notes

- All timestamps: stored and returned as ISO 8601 UTC strings
- Sensor fields are all nullable on ingest — ESP may send partial data
- Fake seed data must include realistic sensor values + intentional threshold violations for testing the alert system
- TimescaleDB hypertable creation should be wrapped in a try/catch — fall back gracefully if the extension is not installed
- Socket.io must be accessible from both the Fastify HTTP server and independently (for testing)