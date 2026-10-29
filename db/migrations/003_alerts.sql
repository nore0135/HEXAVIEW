CREATE TABLE price_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 venue text NOT NULL,
 symbol text NOT NULL,
 direction text NOT NULL CHECK(direction IN ('crosses_above','crosses_below')),
 threshold numeric(28,12) NOT NULL CHECK(threshold>0),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','triggered','cancelled')),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 triggered_at timestamptz
);
CREATE INDEX active_alert_threshold ON price_alerts(venue,symbol,direction,threshold) WHERE status='active';
CREATE INDEX alerts_owner ON price_alerts(user_id,created_at DESC);
-- One-shot alerts: one durable event per alert, regardless of stream retries.
CREATE TABLE alert_outbox (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 alert_id uuid NOT NULL UNIQUE REFERENCES price_alerts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_sequence bigint NOT NULL,
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,
 lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX pending_alert_outbox ON alert_outbox(id) WHERE delivered_at IS NULL;
