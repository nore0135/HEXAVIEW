CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE candles (
 venue text NOT NULL,
 symbol text NOT NULL,
 timeframe text NOT NULL CHECK(timeframe IN ('1m','5m','15m','1h','4h','1d')),
 open_time timestamptz NOT NULL,
 open numeric(28,12) NOT NULL CHECK(open>0),
 high numeric(28,12) NOT NULL,
 low numeric(28,12) NOT NULL CHECK(low>0),
 close numeric(28,12) NOT NULL CHECK(close>0),
 volume numeric(38,12) NOT NULL CHECK(volume>=0),
 is_closed boolean NOT NULL DEFAULT false,
 source_event_time timestamptz NOT NULL,
 PRIMARY KEY(venue,symbol,timeframe,open_time),
 CHECK(high>=GREATEST(open,close,low) AND low<=LEAST(open,close))
);
SELECT create_hypertable('candles', by_range('open_time', INTERVAL '7 days'));
CREATE INDEX candles_range ON candles(venue,symbol,timeframe,open_time DESC);
-- Deliberately no retention policy: long-term history must not be deleted by default.
-- Ingestion must UPSERT on the composite key, accepting only newer
-- source_event_time values and never reopening a finalized candle.
