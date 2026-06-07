use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::pricing;
use super::traits::TokenProvider;
use super::types::{AllStats, DailyUsage, ModelUsage};

// --- Cache infrastructure ---

struct StatsCache {
    stats: AllStats,
    computed_at: Instant,
}

static STATS_CACHE: Mutex<Option<StatsCache>> = Mutex::new(None);
static CACHE_INVALIDATED: AtomicBool = AtomicBool::new(false);
const CACHE_TTL: Duration = Duration::from_secs(60);

/// Invalidate cache — called by file watcher.
pub fn invalidate_stats_cache() {
    CACHE_INVALIDATED.store(true, Ordering::Relaxed);
}

/// Return cached stats without triggering a re-parse.
pub fn get_cached_stats() -> Option<AllStats> {
    STATS_CACHE.lock().ok()?.as_ref().map(|c| c.stats.clone())
}

pub struct HermesProvider {
    db_path: PathBuf,
}

impl HermesProvider {
    pub fn new() -> Self {
        // Default Hermes state.db path
        let home = dirs::home_dir().unwrap_or_default();
        let db_path = home.join("AppData").join("Local").join("hermes").join("state.db");
        Self { db_path }
    }

    pub fn with_path(path: PathBuf) -> Self {
        Self { db_path: path }
    }
}

impl TokenProvider for HermesProvider {
    fn name(&self) -> &str {
        "Hermes"
    }

    fn is_available(&self) -> bool {
        self.db_path.exists()
    }

    fn fetch_stats(&self) -> Result<AllStats, String> {
        let was_invalidated = CACHE_INVALIDATED.swap(false, Ordering::Relaxed);

        if !was_invalidated {
            if let Ok(cache) = STATS_CACHE.lock() {
                if let Some(ref cached) = *cache {
                    if cached.computed_at.elapsed() < CACHE_TTL {
                        return Ok(cached.stats.clone());
                    }
                }
            }
        }

        if !self.db_path.exists() {
            return Err(format!("Hermes state.db not found at {}", self.db_path.display()));
        }

        let conn = rusqlite::Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open Hermes DB: {e}"))?;

        // 1. Query session data
        let mut stmt = conn
            .prepare(
                "SELECT model, started_at, ended_at, message_count, tool_call_count,
                        input_tokens, output_tokens, cache_read_tokens
                 FROM sessions
                 WHERE ended_at IS NOT NULL
                 ORDER BY started_at ASC",
            )
            .map_err(|e| format!("Failed to prepare query: {e}"))?;

        #[derive(Debug)]
        struct SessionRow {
            model: String,
            started_at: f64,
            message_count: i64,
            tool_call_count: i64,
            input_tokens: i64,
            output_tokens: i64,
            cache_read_tokens: i64,
        }

        let sessions: Vec<SessionRow> = stmt
            .query_map([], |row| {
                Ok(SessionRow {
                    model: row.get::<_, String>(0)?,
                    started_at: row.get::<_, f64>(1)?,
                    message_count: row.get::<_, i64>(3).unwrap_or(0),
                    tool_call_count: row.get::<_, i64>(4).unwrap_or(0),
                    input_tokens: row.get::<_, i64>(5).unwrap_or(0).max(0) as i64,
                    output_tokens: row.get::<_, i64>(6).unwrap_or(0).max(0) as i64,
                    cache_read_tokens: row.get::<_, i64>(7).unwrap_or(0).max(0) as i64,
                })
            })
            .map_err(|e| format!("Failed to query sessions: {e}"))?
            .filter_map(|r| r.ok())
            .collect();

        if sessions.is_empty() {
            return Ok(AllStats {
                daily: vec![],
                model_usage: HashMap::new(),
                total_sessions: 0,
                total_messages: 0,
                first_session_date: None,
                analytics: None,
                rate_limits: None,
            });
        }

        let mut daily_map: HashMap<String, DailyUsage> = HashMap::new();
        let mut model_usage_map: HashMap<String, ModelUsage> = HashMap::new();
        let mut total_messages: u32 = 0;
        let mut total_sessions: u32 = 0;
        let mut first_date: Option<String> = None;

        for s in &sessions {
            total_sessions += 1;
            total_messages += s.message_count as u32;

            // Convert Unix timestamp to local date
            use chrono::{TimeZone, Local};
            let dt = Local
                .timestamp_opt(s.started_at as i64, 0)
                .earliest()
                .unwrap_or_else(|| Local.from_utc_datetime(
                    &chrono::NaiveDateTime::from_timestamp_opt(s.started_at as i64, 0)
                        .unwrap_or_default()
                ));
            let date_str = dt.format("%Y-%m-%d").to_string();

            if first_date.as_ref().map_or(true, |d| date_str < *d) {
                first_date = Some(date_str.clone());
            }

            // Get pricing for this model
            let pricing = pricing::get_hermes_pricing(&s.model);
            let input_cost = (s.input_tokens as f64 / 1_000_000.0) * pricing.input;
            let output_cost = (s.output_tokens as f64 / 1_000_000.0) * pricing.output;
            let cache_cost = (s.cache_read_tokens as f64 / 1_000_000.0) * pricing.cache_read;
            let cost = input_cost + output_cost + cache_cost;

            let total_tokens = (s.input_tokens + s.output_tokens + s.cache_read_tokens) as u64;

            let daily = daily_map
                .entry(date_str.clone())
                .or_insert_with(|| DailyUsage {
                    date: date_str.clone(),
                    tokens: HashMap::new(),
                    cost_usd: 0.0,
                    messages: 0,
                    sessions: 0,
                    tool_calls: 0,
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read_tokens: 0,
                    cache_write_tokens: 0,
                });

            *daily.tokens.entry(s.model.clone()).or_insert(0) += total_tokens;
            daily.cost_usd += cost;
            daily.messages += s.message_count as u32;
            daily.sessions += 1;
            daily.tool_calls += s.tool_call_count as u32;
            daily.input_tokens += s.input_tokens as u64;
            daily.output_tokens += s.output_tokens as u64;
            daily.cache_read_tokens += s.cache_read_tokens as u64;

            let mu = model_usage_map
                .entry(s.model.clone())
                .or_insert_with(|| ModelUsage {
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read: 0,
                    cache_write: 0,
                    cost_usd: 0.0,
                });

            mu.input_tokens += s.input_tokens as u64;
            mu.output_tokens += s.output_tokens as u64;
            mu.cache_read += s.cache_read_tokens as u64;
            mu.cost_usd += cost;
        }

        let mut daily: Vec<DailyUsage> = daily_map.into_values().collect();
        daily.sort_by(|a, b| a.date.cmp(&b.date));

        let stats = AllStats {
            daily,
            model_usage: model_usage_map,
            total_sessions,
            total_messages,
            first_session_date: first_date,
            analytics: None,
            rate_limits: None,
        };

        if let Ok(mut cache) = STATS_CACHE.lock() {
            *cache = Some(StatsCache {
                stats: stats.clone(),
                computed_at: Instant::now(),
            });
        }

        Ok(stats)
    }
}
