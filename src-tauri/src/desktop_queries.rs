use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tauri::{Manager, State};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct DictionaryState(Mutex<Option<Connection>>);

#[derive(Default)]
pub struct HttpState(Mutex<HashMap<String, oneshot::Sender<()>>>);

#[derive(Serialize)]
pub struct DictionaryEntry {
    word: String,
    phonetic: Option<String>,
    definition: Option<String>,
    translation: Option<String>,
    pos: Option<String>,
    exchange: Option<String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryResult {
    entry: Option<DictionaryEntry>,
    entries: Vec<DictionaryEntry>,
    resolved_word: Option<String>,
}

const FIELDS: &str = "word, phonetic, definition, translation, pos, exchange";

fn entry_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DictionaryEntry> {
    Ok(DictionaryEntry {
        word: row.get(0)?,
        phonetic: row.get(1)?,
        definition: row.get(2)?,
        translation: row.get(3)?,
        pos: row.get(4)?,
        exchange: row.get(5)?,
    })
}

fn exact(db: &Connection, word: &str) -> rusqlite::Result<Option<DictionaryEntry>> {
    db.query_row(
        &format!("SELECT {FIELDS} FROM stardict WHERE word = ? COLLATE NOCASE LIMIT 1"),
        [word],
        entry_from_row,
    )
    .optional()
}

fn inflection(db: &Connection, word: &str) -> rusqlite::Result<Option<DictionaryEntry>> {
    db.query_row(&format!("SELECT {FIELDS} FROM stardict WHERE exchange IS NOT NULL AND lower('/' || exchange || '/') GLOB ? ORDER BY length(word) LIMIT 1"),
        [format!("*/[pdi3sfrbtz]:{}/*", word.to_ascii_lowercase())], entry_from_row).optional()
}

fn lookup_connection(db: &Connection, word: &str) -> Result<DictionaryResult, String> {
    let word = word.trim();
    static CHINESE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^[\p{Script=Han}]{1,2}$").unwrap());
    if CHINESE.is_match(word) {
        return reverse_lookup(db, word);
    }
    if crate::capture_logic::normalize_word(word).as_deref() != Some(word) {
        return Err("invalid dictionary word".into());
    }
    let mut entry = exact(db, word).map_err(|_| "词库查询失败")?;
    let mut resolved_word = None;
    if entry.is_none() {
        entry = inflection(db, word).map_err(|_| "词形查询失败")?;
        resolved_word = entry.as_ref().map(|item| item.word.clone());
    }
    if let Some(item) = &mut entry {
        if item
            .phonetic
            .as_ref()
            .is_none_or(|value| value.trim().is_empty())
        {
            let lemma = inflection(db, word).map_err(|_| "词形查询失败")?;
            if let Some(lemma) = lemma {
                item.phonetic = lemma.phonetic;
            }
        }
    }
    Ok(DictionaryResult {
        entry,
        entries: Vec::new(),
        resolved_word,
    })
}

fn reverse_lookup(db: &Connection, word: &str) -> Result<DictionaryResult, String> {
    static POS: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i)^[a-z]+\.?\s+").unwrap());
    static DOMAIN: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^[\[［【(][^\]］】)]{1,8}[\]］】)]\s*").unwrap());
    let mut statement = db.prepare(&format!("SELECT {FIELDS} FROM stardict WHERE translation IS NOT NULL AND translation LIKE '%' || ?1 || '%'
        ORDER BY CASE WHEN translation = ?1 THEN 0 WHEN translation LIKE '%' || ?1 || '%' THEN 1 ELSE 2 END,
            CASE WHEN lower(word) = ?1 THEN 0 ELSE 1 END, length(word) LIMIT 200")).map_err(|_| "中文反查失败")?;
    let rows = statement
        .query_map([word], entry_from_row)
        .map_err(|_| "中文反查失败")?;
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for row in rows {
        let item = row.map_err(|_| "中文反查失败")?;
        let translation = item.translation.as_deref().unwrap_or("");
        if item
            .phonetic
            .as_ref()
            .is_none_or(|value| value.trim().is_empty())
            || item
                .definition
                .as_ref()
                .is_none_or(|value| value.trim().is_empty())
            || translation.contains("网络")
            || item
                .exchange
                .as_deref()
                .unwrap_or("")
                .split('/')
                .any(|slot| slot.starts_with("0:"))
        {
            continue;
        }
        let direct = translation
            .lines()
            .flat_map(|line| line.split([';', ',', '，', '；']))
            .any(|fragment| {
                let text = POS.replace(fragment.trim(), "");
                DOMAIN.replace(&text, "").trim() == word
            });
        if direct && seen.insert(item.word.to_lowercase()) {
            entries.push(item);
        }
        if entries.len() == 12 {
            break;
        }
    }
    Ok(DictionaryResult {
        entries,
        ..Default::default()
    })
}

#[tauri::command]
pub async fn desktop_dictionary(
    app: tauri::AppHandle,
    word: String,
    state: State<'_, DictionaryState>,
) -> Result<DictionaryResult, String> {
    let mut db = state.0.lock().map_err(|_| "词库正在关闭")?;
    if db.is_none() {
        let mut path = app
            .path()
            .resource_dir()
            .map_err(|_| "无法定位词库")?
            .join("dictionaries/stardict.db");
        if cfg!(debug_assertions) && !path.exists() {
            path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../data/ecdict-sqlite-28/stardict-slim.db");
        }
        *db = Some(
            Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|_| "本地词库文件不可用")?,
        );
    }
    lookup_connection(db.as_ref().unwrap(), &word)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentials {
    api_base_url: String,
    api_key: String,
    model: String,
}
#[derive(Deserialize, Serialize)]
pub struct ChatMessage {
    role: String,
    content: String,
}
#[derive(Serialize)]
pub struct HttpResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub fn cancel_desktop_ai(request_id: String, state: State<'_, HttpState>) {
    if let Ok(mut requests) = state.0.lock() {
        if let Some(sender) = requests.remove(&request_id) {
            let _ = sender.send(());
        }
    }
}

#[tauri::command]
pub async fn desktop_ai_request(
    credentials: AiCredentials,
    messages: Vec<ChatMessage>,
    timeout_ms: u64,
    request_id: String,
    state: State<'_, HttpState>,
) -> Result<HttpResponse, String> {
    let endpoint = reqwest::Url::parse(&format!(
        "{}/chat/completions",
        credentials.api_base_url.trim().trim_end_matches('/')
    ))
    .map_err(|_| "AI 接口地址无效")?;
    if !["http", "https"].contains(&endpoint.scheme())
        || credentials.api_key.trim().is_empty()
        || credentials.model.trim().is_empty()
        || messages.is_empty()
    {
        return Err("AI 接口配置不完整".into());
    }
    let (sender, cancel) = oneshot::channel();
    state
        .0
        .lock()
        .map_err(|_| "AI 请求无法启动")?
        .insert(request_id.clone(), sender);
    let operation = async {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(timeout_ms.clamp(1000, 60000)))
            .build()
            .map_err(|_| "AI 请求无法启动")?;
        let response = client.post(endpoint).bearer_auth(credentials.api_key.trim())
            .json(&serde_json::json!({ "model": credentials.model.trim(), "messages": messages, "temperature": 0.2 }))
            .send().await.map_err(|error| if error.is_timeout() { "AI 接口请求超时" } else { "AI 接口连接失败" })?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|_| "AI 返回内容读取失败")?;
        Ok(HttpResponse { status, body })
    };
    let result =
        tokio::select! { result = operation => result, _ = cancel => Err("AI 请求已取消".into()) };
    if let Ok(mut requests) = state.0.lock() {
        requests.remove(&request_id);
    }
    result
}

// ---------------------------------------------------------------------------
// 批量原子查询层
//
// 与 server/dictionaryLookup.ts 一一对应：按给定的词返回词库条目，
// **不做任何优先级判断**。谁优先、取几条、怎么排序属于前端共享策略层。
// 三份库任意一份缺失时把该来源当空结果，不报错——词库还没构建时就是这种状态。
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct LookupState {
    oxford: Mutex<Option<Connection>>,
    cedict: Mutex<Option<Connection>>,
    ecdict: Mutex<Option<Connection>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OxfordRecord {
    word: String,
    headword: String,
    pos: String,
    senses: serde_json::Value,
    collocations: serde_json::Value,
    collocation_translations: serde_json::Value,
    examples: serde_json::Value,
}

#[derive(Serialize)]
pub struct LookupHit {
    #[serde(skip_serializing_if = "Option::is_none")]
    oxford: Option<OxfordRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ecdict: Option<DictionaryEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseHit {
    word: String,
    source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    sense_index: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rank: Option<f64>,
}

/// 先看安装目录，开发构建下缺文件再回退到仓库 data 目录。
fn dictionary_path(app: &tauri::AppHandle, resource: &str, dev_relative: &str) -> Result<PathBuf, String> {
    let installed = app
        .path()
        .resource_dir()
        .map_err(|_| "无法定位词库")?
        .join(resource);
    if cfg!(debug_assertions) && !installed.exists() {
        let fallback = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../data")
            .join(dev_relative);
        if fallback.exists() {
            return Ok(fallback);
        }
    }
    Ok(installed)
}

fn open_readonly(path: &std::path::Path) -> Option<Connection> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
}

fn with_database<T>(
    slot: &Mutex<Option<Connection>>,
    app: &tauri::AppHandle,
    resource: &str,
    dev_relative: &str,
    query: impl FnOnce(Option<&Connection>) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = slot.lock().map_err(|_| "词库正在关闭")?;
    if guard.is_none() {
        let path = dictionary_path(app, resource, dev_relative)?;
        *guard = open_readonly(&path);
    }
    query(guard.as_ref())
}

fn parse_json(text: &str, fallback: serde_json::Value) -> serde_json::Value {
    serde_json::from_str(text).unwrap_or(fallback)
}

/// 中文反查的输入比按词查询宽松：不限 1-2 个汉字，但必须整串都是汉字。
static CHINESE_TERM: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^[\p{Script=Han}]{1,12}$").unwrap());

fn read_oxford(db: &Connection, word: &str) -> rusqlite::Result<Option<OxfordRecord>> {
    db.query_row(
        "SELECT headword, pos, senses, collocations, collocation_translations, examples
         FROM entry WHERE word = ? COLLATE NOCASE LIMIT 1",
        [word],
        |row| {
            Ok(OxfordRecord {
                word: word.to_string(),
                headword: row.get(0)?,
                pos: row.get(1)?,
                senses: parse_json(&row.get::<_, String>(2)?, serde_json::json!([])),
                collocations: parse_json(&row.get::<_, String>(3)?, serde_json::json!([])),
                collocation_translations: parse_json(&row.get::<_, String>(4)?, serde_json::json!({})),
                examples: parse_json(&row.get::<_, String>(5)?, serde_json::json!([])),
            })
        },
    )
    .optional()
}

fn read_ecdict(db: &Connection, word: &str) -> rusqlite::Result<Option<DictionaryEntry>> {
    exact(db, word)
}

fn read_rank(db: &Connection, word: &str) -> Option<f64> {
    let row = db
        .query_row(
            "SELECT bnc, frq FROM stardict WHERE word = ? COLLATE NOCASE LIMIT 1",
            [word],
            |row| Ok((row.get::<_, Option<f64>>(0)?, row.get::<_, Option<f64>>(1)?)),
        )
        .optional()
        .ok()
        .flatten()?;
    let rank = row.0.or(row.1)?;
    (rank > 0.0).then_some(rank)
}

fn read_cedict_glosses(db: &Connection, term: &str) -> rusqlite::Result<Vec<String>> {
    let mut statement = db.prepare("SELECT gloss FROM cedict WHERE term = ?")?;
    let rows = statement.query_map([term], |row| row.get::<_, String>(0))?;
    Ok(rows.flatten().collect())
}

fn read_hanzi(db: &Connection, term: &str) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut statement =
        db.prepare("SELECT word, sense_index FROM hanzi WHERE term = ? ORDER BY sense_index, word")?;
    let rows = statement.query_map([term], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?;
    Ok(rows.flatten().collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoudaoIpa {
    usphone: String,
    ukphone: String,
}

/// Public website dictionary, without developer credentials. Requests stay on the
/// native side to avoid WebView CORS; only dictionary fields cross the bridge.
fn valid_youdao_dictionary_query(word: &str) -> bool {
    static ENGLISH_QUERY: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"^[a-zA-Z]+(?:[-'][a-zA-Z]+)*(?: +[a-zA-Z]+(?:[-'][a-zA-Z]+)*){0,5}$").unwrap()
    });
    word.chars().count() <= 80 && (ENGLISH_QUERY.is_match(word) || CHINESE_TERM.is_match(word))
}

#[tauri::command]
pub async fn youdao_dictionary(word: String) -> Result<serde_json::Value, String> {
    let word = word.trim();
    if !valid_youdao_dictionary_query(word) {
        return Err("invalid dictionary word".into());
    }
    let mut url = reqwest::Url::parse("https://dict.youdao.com/jsonapi")
        .map_err(|error| error.to_string())?;
    url.query_pairs_mut().append_pair("q", word);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|error| error.to_string())?;
    let payload: serde_json::Value = client
        .get(url)
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0")
        .send().await.map_err(|error| error.to_string())?
        .error_for_status().map_err(|error| error.to_string())?
        .json().await.map_err(|error| error.to_string())?;
    Ok(serde_json::json!({
        "ec": payload.get("ec"),
        "ce": payload.get("ce"),
        "phrs": payload.get("phrs"),
        "blng_sents_part": payload.get("blng_sents_part"),
    }))
}

#[tauri::command]
pub async fn youdao_ipa(word: String) -> Result<YoudaoIpa, String> {
    let word = word.trim().to_lowercase();
    let empty = YoudaoIpa { usphone: String::new(), ukphone: String::new() };
    if word.is_empty() {
        return Ok(empty);
    }
    let mut url = reqwest::Url::parse("https://dict.youdao.com/jsonapi")
        .map_err(|error| format!("有道的地址拼不出来：{error}"))?;
    url.query_pairs_mut().append_pair("q", &word);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("有道 HTTP 客户端建不起来：{error}"))?;
    let response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0")
        .send()
        .await
        .map_err(|error| format!("有道请求失败：{error}"))?;
    if !response.status().is_success() {
        return Ok(empty);
    }
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("有道返回的不是 JSON：{error}"))?;
    let entry = payload
        .get("ec")
        .and_then(|ec| ec.get("word"))
        .and_then(|words| words.get(0));
    let text = |key: &str| {
        entry
            .and_then(|item| item.get(key))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    Ok(YoudaoIpa { usphone: text("usphone"), ukphone: text("ukphone") })
}

#[tauri::command]
pub fn dictionary_lookup(
    app: tauri::AppHandle,
    words: Vec<String>,
    state: State<'_, LookupState>,
) -> Result<HashMap<String, LookupHit>, String> {
    let mut result: HashMap<String, LookupHit> = HashMap::new();
    let only_english: Vec<String> = words
        .into_iter()
        .map(|word| word.trim().to_string())
        .filter(|word| !word.is_empty() && crate::capture_logic::normalize_word(word).as_deref() == Some(word))
        .collect();

    for word in only_english {
        let key = word.to_lowercase();
        if result.contains_key(&key) {
            continue;
        }
        let oxford = with_database(&state.oxford, &app, "dictionaries/landict-oxford.db", "oxford-sqlite/landict-oxford.db", |db| {
            Ok(db.and_then(|db| read_oxford(db, &word).ok().flatten()))
        })?;
        let ecdict = with_database(&state.ecdict, &app, "dictionaries/stardict.db", "ecdict-sqlite/stardict-slim.db", |db| {
            Ok(db.and_then(|db| read_ecdict(db, &word).ok().flatten()))
        })?;
        result.insert(key, LookupHit { oxford, ecdict });
    }
    Ok(result)
}

fn suggested_words(db: &Connection, prefix: &str, words: &[String]) -> rusqlite::Result<Vec<String>> {
    const RANK: &str = "CASE WHEN bnc > 0 THEN bnc WHEN frq > 0 THEN frq ELSE 2147483647 END";
    const COMMON: &str = "(bnc > 0 OR frq > 0) AND word NOT GLOB '*[^a-z]*'";
    let valid = |word: &str| word.len() >= 2 && word.len() <= 33 && word.bytes().all(|c| c.is_ascii_lowercase());
    let prefix = prefix.trim().to_ascii_lowercase();
    if !prefix.is_empty() {
        if !valid(&prefix) || prefix.len() > 32 { return Ok(Vec::new()); }
        return db.prepare(&format!("SELECT word FROM stardict WHERE word >= ?1 AND word < ?2 AND length(word) > ?3 AND {COMMON} ORDER BY {RANK}, length(word), word LIMIT 5"))?
            .query_map(rusqlite::params![prefix, format!("{prefix}{{"), prefix.len() as i64], |row| row.get::<_, String>(0))?.collect();
    }
    let words: Vec<_> = words.iter().filter(|word| valid(word)).take(2000).collect();
    let mut found: Vec<(String, f64)> = Vec::new();
    for batch in words.chunks(300) {
        let placeholders = vec!["?"; batch.len()].join(",");
        let mut statement = db.prepare(&format!("SELECT word, {RANK} FROM stardict WHERE word IN ({placeholders}) AND {COMMON}"))?;
        for row in statement.query_map(rusqlite::params_from_iter(batch.iter()), |row| Ok((row.get(0)?, row.get(1)?)))? { found.push(row?); }
    }
    found.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
    found.dedup_by(|a, b| a.0 == b.0);
    Ok(found.into_iter().take(5).map(|item| item.0).collect())
}

#[tauri::command]
pub fn dictionary_suggest(app: tauri::AppHandle, prefix: String, words: Vec<String>, state: State<'_, LookupState>) -> Result<Vec<String>, String> {
    with_database(&state.ecdict, &app, "dictionaries/stardict.db", "ecdict-sqlite/stardict-slim.db", |db| {
        db.map(|db| suggested_words(db, &prefix, &words).map_err(|_| "本地词典建议暂时不可用".to_string())).unwrap_or_else(|| Ok(Vec::new()))
    })
}

#[tauri::command]
pub fn dictionary_reverse(
    app: tauri::AppHandle,
    term: String,
    state: State<'_, LookupState>,
) -> Result<Vec<ReverseHit>, String> {
    let term = term.trim().to_string();
    if term.is_empty() {
        return Ok(Vec::new());
    }
    let mut hits: Vec<ReverseHit> = Vec::new();

    with_database(&state.cedict, &app, "dictionaries/landict-cedict.db", "cedict-sqlite/landict-cedict.db", |db| {
        if let Some(db) = db {
            for gloss in read_cedict_glosses(db, &term).map_err(|_| "反查失败")? {
                hits.push(ReverseHit { word: gloss, source: "cedict", sense_index: None, rank: None });
            }
        }
        Ok(())
    })?;

    with_database(&state.oxford, &app, "dictionaries/landict-oxford.db", "oxford-sqlite/landict-oxford.db", |db| {
        if let Some(db) = db {
            for (word, sense_index) in read_hanzi(db, &term).map_err(|_| "反查失败")? {
                hits.push(ReverseHit { word, source: "oxford", sense_index: Some(sense_index), rank: None });
            }
        }
        Ok(())
    })?;

    with_database(&state.ecdict, &app, "dictionaries/stardict.db", "ecdict-sqlite/stardict-slim.db", |db| {
        let Some(db) = db else { return Ok(()) };
        if !CHINESE_TERM.is_match(&term) {
            return Ok(());
        }
        let mut statement = db
            .prepare(
                "SELECT word FROM stardict WHERE translation IS NOT NULL AND translation LIKE '%' || ?1 || '%'
                 ORDER BY CASE WHEN translation = ?1 THEN 0 ELSE 1 END, length(word) LIMIT 12",
            )
            .map_err(|_| "反查失败")?;
        let rows = statement.query_map([&term], |row| row.get::<_, String>(0)).map_err(|_| "反查失败")?;
        for row in rows.flatten() {
            hits.push(ReverseHit { word: row, source: "ecdict", sense_index: None, rank: None });
        }
        Ok(())
    })?;

    // 英文词频由精简 ECDICT 提供，供策略层排序。
    with_database(&state.ecdict, &app, "dictionaries/stardict.db", "ecdict-sqlite/stardict-slim.db", |db| {
        if let Some(db) = db {
            for hit in &mut hits {
                hit.rank = read_rank(db, &hit.word);
            }
        }
        Ok(())
    })?;

    Ok(hits)
}

#[tauri::command]
pub fn dictionary_lemmas(
    app: tauri::AppHandle,
    words: Vec<String>,
    state: State<'_, LookupState>,
) -> Result<HashMap<String, String>, String> {
    with_database(&state.oxford, &app, "dictionaries/landict-oxford.db", "oxford-sqlite/landict-oxford.db", |db| {
        let mut result = HashMap::new();
        let Some(db) = db else { return Ok(result) };
        let mut statement = db
            .prepare("SELECT base FROM lemma WHERE form = ? COLLATE NOCASE LIMIT 1")
            .map_err(|_| "词形查询失败")?;
        for word in words {
            let key = word.trim().to_lowercase();
            if key.is_empty() || result.contains_key(&key) {
                continue;
            }
            if let Ok(Some(base)) = statement
                .query_row([&key], |row| row.get::<_, String>(0))
                .optional()
            {
                result.insert(key, base);
            }
        }
        Ok(result)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn suggestions_rank_common_words_and_only_return_exact_candidates() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE stardict(word TEXT PRIMARY KEY, bnc REAL, frq REAL);
            INSERT INTO stardict VALUES ('captain',100,0),('capture',200,0),('capturer',0,0),('dog',40,0);").unwrap();
        assert_eq!(suggested_words(&db, "CAPT", &[]).unwrap(), vec!["captain", "capture"]);
        assert_eq!(suggested_words(&db, "", &["capture".into(), "captuer".into()]).unwrap(), vec!["capture"]);
        assert!(suggested_words(&db, "%", &[]).unwrap().is_empty());
    }

    #[test]
    fn youdao_query_accepts_bounded_terms_and_rejects_unsafe_inputs() {
        for word in ["cat", "放弃", "猫", "计算机", "look forward to", "state-of-the-art technology", "don't give up"] {
            assert!(valid_youdao_dictionary_query(word), "{word}");
        }
        for word in ["", "猫 cat", "https://example.com", "猫?", "一二三四五六七八九十一二三", "look forward to.", "one two three four five six seven", "look\nforward", "look\tforward"] {
            assert!(!valid_youdao_dictionary_query(word), "{word}");
        }
        assert!(!valid_youdao_dictionary_query(&"a".repeat(81)));
    }

    #[test]
    fn native_chinese_lookup_filters_network_entries_and_partial_meanings() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE stardict(word TEXT, phonetic TEXT, definition TEXT, translation TEXT, pos TEXT, exchange TEXT);
            INSERT INTO stardict VALUES ('cat','kæt','cat','n. 猫, 猫科动物','n','s:cats');
            INSERT INTO stardict VALUES ('cats','kæts','cats','n. 猫','n','0:cat/1:s');
            INSERT INTO stardict VALUES ('catlike','kat','catlike','adj. 猫一样的','adj','');
            INSERT INTO stardict VALUES ('netcat','net','netcat','[网络] 猫','n','');").unwrap();
        let result = lookup_connection(&db, "猫").unwrap();
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].word, "cat");
    }

    #[test]
    fn native_dictionary_preserves_exact_entries_and_real_inflections() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE stardict(word TEXT, phonetic TEXT, definition TEXT, translation TEXT, pos TEXT, exchange TEXT);
            INSERT INTO stardict VALUES ('run','rʌn','run','跑','v','p:ran/d:run');
            INSERT INTO stardict VALUES ('children',NULL,'children','孩子们','n','0:child/1:s');
            INSERT INTO stardict VALUES ('child','tʃaɪld','child','孩子','n','s:children');
            INSERT INTO stardict VALUES ('rans',NULL,'wrong','错误','n','0:ran/1:s');").unwrap();
        let exact = lookup_connection(&db, "children").unwrap();
        assert_eq!(exact.entry.unwrap().word, "children");
        let past = lookup_connection(&db, "ran").unwrap();
        assert_eq!(past.entry.unwrap().word, "run");
        assert_eq!(past.resolved_word.as_deref(), Some("run"));
        assert!(lookup_connection(&db, "unknown").unwrap().entry.is_none());
        assert!(lookup_connection(&db, "run%'").is_err());
    }

    const OXFORD_SCHEMA: &str = "CREATE TABLE entry(word TEXT, headword TEXT, pos TEXT, senses TEXT,
        collocations TEXT, collocation_translations TEXT, examples TEXT);
        CREATE TABLE hanzi(term TEXT, word TEXT, sense_index INTEGER);
        CREATE TABLE lemma(form TEXT, base TEXT);";

    #[test]
    fn lookup_layer_reads_oxford_entries_and_reports_missing_ones_as_none() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(OXFORD_SCHEMA).unwrap();
        db.execute(
            "INSERT INTO entry VALUES ('cat','cat','noun','[{\"pos\":\"noun\",\"definition\":\"a small animal.\",\"translation\":\"猫\"}]','[]','{}','[]')",
            [],
        )
        .unwrap();

        let record = read_oxford(&db, "cat").unwrap().unwrap();
        assert_eq!(record.headword, "cat");
        assert_eq!(record.senses[0]["translation"], "猫");
        // 缺字段时给空集合而不是 null，前端不必额外判空。
        assert_eq!(record.collocations, serde_json::json!([]));
        assert!(read_oxford(&db, "qqxzvnotaword").unwrap().is_none());
    }

    #[test]
    fn lookup_layer_treats_unranked_words_as_having_no_frequency() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE stardict(word TEXT, phonetic TEXT, definition TEXT, translation TEXT, pos TEXT, exchange TEXT, bnc REAL, frq REAL);
             INSERT INTO stardict VALUES ('abandon','','','','','',2057,2182);
             INSERT INTO stardict VALUES ('ran','','','','','',0,0);",
        )
        .unwrap();
        assert_eq!(read_rank(&db, "abandon"), Some(2057.0));
        // 变形词在 ECDICT 里没有词频，必须当作无排名，不能排到原型前面。
        assert_eq!(read_rank(&db, "ran"), None);
    }

    #[test]
    fn reverse_layer_answers_from_cedict_and_oxford() {
        let cedict = Connection::open_in_memory().unwrap();
        cedict
            .execute_batch("CREATE TABLE cedict(term TEXT, gloss TEXT);
                INSERT INTO cedict VALUES ('放弃','abandon'),('放弃','give up');")
            .unwrap();
        let glosses = read_cedict_glosses(&cedict, "放弃").unwrap();
        assert!(glosses.contains(&"abandon".to_string()));
        assert!(read_cedict_glosses(&cedict, "没有收录").unwrap().is_empty());

        let oxford = Connection::open_in_memory().unwrap();
        oxford.execute_batch(OXFORD_SCHEMA).unwrap();
        oxford
            .execute_batch("INSERT INTO hanzi VALUES ('猫','cat',0),('猫','cat',1),('猫','feline',0);")
            .unwrap();
        let hits = read_hanzi(&oxford, "猫").unwrap();
        assert_eq!(hits[0], ("cat".to_string(), 0));
        assert_eq!(hits[1], ("feline".to_string(), 0));
    }

    #[test]
    fn lookup_layer_treats_a_missing_dictionary_file_as_an_empty_source() {
        // 词库还没构建、或安装目录里缺文件时，命令必须给出空结果而不是崩在启动路径上。
        let missing = std::path::Path::new("__no_such_directory__/landict-oxford.db");
        assert!(open_readonly(missing).is_none());

        // 列式 JSON 解析失败时回落到空集合，同样不 panic。
        assert_eq!(parse_json("not json at all", serde_json::json!([])), serde_json::json!([]));
        assert_eq!(parse_json("", serde_json::json!({})), serde_json::json!({}));
    }
}
