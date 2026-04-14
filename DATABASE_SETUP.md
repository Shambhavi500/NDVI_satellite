# MindstriX Database Setup Guide

Your schema uses two databases: **PostgreSQL** (with PostGIS) for all relational data, and **Cloud Firestore** for real-time sessions and alerts.

---

## Part 1 — PostgreSQL Setup

### Step 1: Install PostGIS

Open your terminal, connect to Postgres, and enable the required extensions:

```sql
psql -U postgres

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Step 2: Create the database

```sql
CREATE DATABASE mindstrix;
\c mindstrix

-- Enable extensions inside this new database too (required!)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Step 3: Create ENUM types

These must be created *before* the tables. Paste all of this:

```sql
CREATE TYPE org_type_enum AS ENUM ('fpo','cooperative','agri_company','ngo','government');
CREATE TYPE plan_tier_enum AS ENUM ('basic','professional','enterprise');
CREATE TYPE user_role_enum AS ENUM ('farmer','enterprise_admin','enterprise_member','api_system');
CREATE TYPE language_enum AS ENUM ('english','hindi','marathi','kannada','tamil','telugu','others');
CREATE TYPE gender_enum AS ENUM ('male','female','other','prefer_not_to_say');
CREATE TYPE area_unit_enum AS ENUM ('acres','hectares');
CREATE TYPE land_ownership_enum AS ENUM ('own_land','leased_land','contract_farming');
CREATE TYPE irrigation_type_enum AS ENUM ('rainfed','borewell','canal','drip','sprinkler','tank');
CREATE TYPE soil_type_enum AS ENUM ('black','red','sandy','loamy','mixed','unknown');
CREATE TYPE season_enum AS ENUM ('kharif','rabi','zaid');
CREATE TYPE consent_type_enum AS ENUM ('satellite_monitoring','data_sharing','marketing');
CREATE TYPE trigger_source_enum AS ENUM ('scheduled','farmer_manual','enterprise_manual','api');
```

### Step 4: Create tables in this exact order (foreign key dependencies)

```sql
-- 1. organizations
CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255) NOT NULL,
  org_type      org_type_enum NOT NULL,
  country       VARCHAR(100) NOT NULL,
  state         VARCHAR(100) NOT NULL,
  contact_email VARCHAR(255) UNIQUE NOT NULL,
  contact_phone VARCHAR(20),
  logo_url      TEXT,
  plan_tier     plan_tier_enum NOT NULL DEFAULT 'basic',
  max_farmers   INTEGER NOT NULL DEFAULT 100,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. users
CREATE TABLE users (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  firebase_uid       VARCHAR(128) UNIQUE NOT NULL,
  role               user_role_enum NOT NULL,
  org_id             UUID REFERENCES organizations(id),
  mobile_number      VARCHAR(20) UNIQUE,
  email              VARCHAR(255) UNIQUE,
  full_name          VARCHAR(255) NOT NULL,
  preferred_language language_enum NOT NULL DEFAULT 'english',
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 3. farmer_profiles
CREATE TABLE farmer_profiles (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID UNIQUE NOT NULL REFERENCES users(id),
  age                 INTEGER,
  gender              gender_enum,
  profile_photo_url   TEXT,
  onboarding_step     INTEGER NOT NULL DEFAULT 1,
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 4. farmer_locations
CREATE TABLE farmer_locations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id),
  pin_code     VARCHAR(10) NOT NULL,
  state        VARCHAR(100),
  district     VARCHAR(100),
  taluka       VARCHAR(100),
  village_name VARCHAR(255) NOT NULL,
  full_address TEXT,
  is_primary   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 5. farms
CREATE TABLE farms (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id      UUID NOT NULL REFERENCES users(id),
  org_id             UUID REFERENCES organizations(id),
  farm_name          VARCHAR(255) NOT NULL,
  total_area         NUMERIC(10,4) NOT NULL,
  area_unit          area_unit_enum NOT NULL,
  land_ownership     land_ownership_enum NOT NULL,
  latitude           DOUBLE PRECISION NOT NULL,
  longitude          DOUBLE PRECISION NOT NULL,
  boundary_geom      GEOMETRY(POLYGON, 4326),
  location_photo_url TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 6. crops
CREATE TABLE crops (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id               UUID NOT NULL REFERENCES farms(id),
  crop_name             VARCHAR(255) NOT NULL,
  crop_variety          VARCHAR(255),
  sowing_date           DATE NOT NULL,
  season                season_enum NOT NULL,
  expected_harvest_date DATE,
  area_under_crop       NUMERIC(10,4),
  is_current            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- 7. irrigation
CREATE TABLE irrigation (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id             UUID NOT NULL REFERENCES farms(id),
  irrigation_type     irrigation_type_enum NOT NULL,
  water_source_detail TEXT,
  is_primary          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 8. soil_info
CREATE TABLE soil_info (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id            UUID UNIQUE REFERENCES farms(id),
  soil_type          soil_type_enum,
  ph_level           NUMERIC(4,2),
  organic_matter_pct NUMERIC(5,2),
  last_tested_date   DATE,
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 9. consents
CREATE TABLE consents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id),
  consent_type    consent_type_enum NOT NULL,
  is_granted      BOOLEAN NOT NULL,
  consent_version VARCHAR(20) NOT NULL DEFAULT 'v1.0',
  ip_address      INET,
  device_info     JSONB,
  consented_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. vi_reports
CREATE TABLE vi_reports (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id          UUID NOT NULL REFERENCES farms(id),
  triggered_by     UUID REFERENCES users(id),
  trigger_source   trigger_source_enum NOT NULL,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  scene_count      INTEGER NOT NULL,
  confidence_score NUMERIC(5,4) NOT NULL,
  cvi_mean         NUMERIC(7,4) NOT NULL,
  cvi_median       NUMERIC(7,4) NOT NULL,
  cvi_std_dev      NUMERIC(7,4) NOT NULL,
  ndvi             NUMERIC(7,4) NOT NULL,
  evi              NUMERIC(7,4) NOT NULL,
  savi             NUMERIC(7,4) NOT NULL,
  ndmi             NUMERIC(7,4) NOT NULL,
  ndwi             NUMERIC(7,4) NOT NULL,
  gndvi            NUMERIC(7,4) NOT NULL,
  ndvi_histogram   JSONB,
  grid_geojson_url TEXT,
  tile_urls        JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 11. api_keys
CREATE TABLE api_keys (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id             UUID NOT NULL REFERENCES organizations(id),
  created_by         UUID NOT NULL REFERENCES users(id),
  name               VARCHAR(255) NOT NULL,
  key_prefix         VARCHAR(12) NOT NULL,
  key_hash           VARCHAR(64) UNIQUE NOT NULL,
  scopes             JSONB NOT NULL DEFAULT '[]',
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  rate_limit_per_day INTEGER NOT NULL DEFAULT 5000,
  allowed_farm_ids   UUID[],
  expires_at         TIMESTAMPTZ,
  last_used_at       TIMESTAMPTZ,
  total_requests     BIGINT NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 12. api_request_logs
CREATE TABLE api_request_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id  UUID REFERENCES api_keys(id),
  org_id      UUID REFERENCES organizations(id),
  endpoint    VARCHAR(255) NOT NULL,
  method      VARCHAR(10) NOT NULL,
  farm_id     UUID,
  status_code INTEGER NOT NULL,
  response_ms INTEGER,
  ip_address  INET,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 13. webhooks
CREATE TABLE webhooks (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  url               TEXT NOT NULL,
  event_types       JSONB NOT NULL,
  secret_hash       VARCHAR(64) NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  failure_count     INTEGER NOT NULL DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### Step 5: Create indexes

```sql
CREATE INDEX ON farms(owner_user_id);
CREATE INDEX ON farms(org_id);
CREATE INDEX ON farms USING GIST(boundary_geom);
CREATE INDEX ON vi_reports(farm_id, created_at DESC);
CREATE INDEX ON api_keys(key_hash);
CREATE INDEX ON crops(farm_id) WHERE is_current = TRUE;
CREATE INDEX ON users(mobile_number);
CREATE INDEX ON users(firebase_uid);
```

### Step 6: Verify

```sql
\dt                          -- should list all 13 tables
SELECT postgis_version();    -- should return a version string
```

---

## Part 2 — Cloud Firestore Setup

Firestore is schema-less, so there's nothing to "create" like SQL tables. Collections are created automatically when your app writes to them. You just need to configure Firebase.

**Step 1 — Create a Firebase project.** Go to `console.firebase.google.com` → Add project → name it `mindstrix`.

**Step 2 — Enable Firestore.** In the sidebar go to Build → Firestore Database → Create database. Choose **production mode** and select region `asia-south1` (Mumbai) for India.

**Step 3 — Set security rules.** In the Firestore console, go to the Rules tab and paste:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /otp_sessions/{mobile} {
      allow read, write: if request.auth != null
        && request.auth.token.phone_number == mobile;
    }
    match /farmer_sessions/{userId} {
      allow read, write: if request.auth != null
        && request.auth.uid == userId;
    }
    match /farm_alerts/{farmId} {
      allow read: if request.auth != null;
      allow write: if false; // backend only
    }
    match /org_live_stats/{orgId} {
      allow read: if request.auth != null;
      allow write: if false; // backend only
    }
  }
}
```

**Step 4 — Enable TTL on OTP sessions.** Go to Firestore → Indexes → TTL policies tab → Add TTL policy → Collection: `otp_sessions`, Field: `expires_at`. This auto-deletes expired OTP documents without any cron job.

**Step 5 — Get your service account key** (for your backend server). Go to Project Settings → Service accounts → Generate new private key. Store the downloaded JSON file securely — never commit it to git. Your backend uses it like this:

```js
const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert(require('./serviceAccountKey.json'))
});
const db = admin.firestore();
```

Your 4 Firestore collections — `/otp_sessions`, `/farmer_sessions`, `/farm_alerts`, `/org_live_stats` — will be created automatically the first time your app writes to them.
