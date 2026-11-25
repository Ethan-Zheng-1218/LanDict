use serde::Serialize;
use std::time::Duration;

// Keep aligned with SOURCE_ENDPOINTS in features/reading/newsSources.ts.
fn source_endpoints(source: &str) -> Option<(&'static [&'static str], &'static [&'static str])> {
    match source {
        "bbc" => Some((
            &[
                "https://feeds.bbci.co.uk/news/world/rss.xml",
                "https://feeds.bbci.co.uk/news/business/rss.xml",
                "https://feeds.bbci.co.uk/news/technology/rss.xml",
                "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
                "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
            ],
            &["bbc.com", "www.bbc.com", "bbc.co.uk", "www.bbc.co.uk"],
        )),
        "cgtn" => Some((
            &[
                "https://www.cgtn.com/subscribe/rss/section/world.xml",
                "https://www.cgtn.com/subscribe/rss/section/business.xml",
                "https://www.cgtn.com/subscribe/rss/section/tech-sci.xml",
                "https://www.cgtn.com/subscribe/rss/section/culture.xml",
            ],
            &["news.cgtn.com", "www.cgtn.com"],
        )),
        "voa" => Some((
            &["https://projects.voanews.com/global2/"],
            &["www.voanews.com"],
        )),
        "un-news" => Some((
            &["https://news.un.org/feed/subscribe/en/news/all/rss.xml"],
            &["news.un.org"],
        )),
        "rest-of-world" => Some((
            &["https://restofworld.org/feed/"],
            &["restofworld.org", "www.restofworld.org"],
        )),
        // Aeon's configured /feed endpoint redirects to this official RSS URL.
        "aeon" => Some((
            &["https://aeon.co/feed", "https://aeon.co/feed.rss"],
            &["aeon.co", "www.aeon.co"],
        )),
        "quanta" => Some((
            &["https://www.quantamagazine.org/feed/"],
            &["quantamagazine.org", "www.quantamagazine.org"],
        )),
        "works-in-progress" => Some((
            &["https://worksinprogress.co/rss.xml"],
            &["worksinprogress.co", "www.worksinprogress.co"],
        )),
        _ => None,
    }
}

fn allowed_article_path(source: &str, path: &str) -> bool {
    match source {
        "bbc" | "cgtn" => path.starts_with("/news/"),
        "voa" => path.starts_with("/a/"),
        "un-news" => path.starts_with("/en/story/"),
        "aeon" => ["/essays/", "/ideas/", "/stories/", "/films/", "/magazine/"]
            .iter()
            .any(|prefix| path.starts_with(prefix)),
        "quanta" => {
            path.starts_with('/')
                && path.ends_with('/')
                && path.len() > 2
                && !path[1..path.len() - 1].contains('/')
        }
        "rest-of-world" => {
            path.len() > 1
                && !["/platforms/", "/subscribe/", "/about/", "/inside/"]
                    .iter()
                    .any(|prefix| path.starts_with(prefix))
        }
        "works-in-progress" => {
            path.len() > 1
                && !["/about/", "/newsletter/", "/feed/"]
                    .iter()
                    .any(|prefix| path.starts_with(prefix))
        }
        _ => false,
    }
}

fn validate_url(source: &str, value: &str) -> Result<(reqwest::Url, bool), String> {
    let (feeds, hosts) = source_endpoints(source).ok_or("Unsupported reading source")?;
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid reading source URL")?;
    let is_feed = feeds.contains(&value);
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || (!is_feed
            && !(hosts.contains(&url.host_str().unwrap_or(""))
                && allowed_article_path(source, url.path())))
    {
        return Err("Unsupported reading source URL".into());
    }
    Ok((url, is_feed))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingSourceResponse {
    status: u16,
    body: String,
    content_type: String,
}

#[tauri::command]
pub async fn reading_source(source: String, url: String) -> Result<ReadingSourceResponse, String> {
    let (url, is_feed) = validate_url(&source, &url)?;
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(if is_feed { 15 } else { 12 }))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 10 {
                attempt.error("Too many reading source redirects")
            } else if validate_url(&source, attempt.url().as_str()).is_err() {
                attempt.error("Unsupported reading source redirect")
            } else {
                attempt.follow()
            }
        }));
    // Otherwise reqwest's existing system-proxy feature follows the Windows proxy settings.
    if let Ok(proxy) =
        std::env::var("READING_HTTP_PROXY").or_else(|_| std::env::var("BBC_HTTP_PROXY"))
    {
        builder =
            builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| "Invalid reading HTTP proxy")?);
    }
    let client = builder
        .build()
        .map_err(|error| format!("Reading HTTP client failed: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Reading source request failed: {error}"))?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|header| header.to_str().ok())
        .unwrap_or(if is_feed {
            "application/xml; charset=utf-8"
        } else {
            "text/html; charset=utf-8"
        })
        .to_owned();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Reading source body failed: {error}"))?;
    Ok(ReadingSourceResponse {
        status,
        body,
        content_type,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_aeons_official_feed_redirect_as_a_feed() {
        assert_eq!(
            validate_url("aeon", "https://aeon.co/feed.rss").map(|(_, is_feed)| is_feed),
            Ok(true),
        );
    }

    #[test]
    fn accepts_official_https_feeds_and_articles_for_all_sources() {
        let cases = [
            ("bbc", "https://feeds.bbci.co.uk/news/world/rss.xml", true),
            (
                "bbc",
                "https://www.bbc.co.uk/news/articles/example?at_campaign=rss",
                false,
            ),
            (
                "cgtn",
                "https://www.cgtn.com/subscribe/rss/section/world.xml",
                true,
            ),
            (
                "cgtn",
                "https://news.cgtn.com/news/2026/story/index.html",
                false,
            ),
            ("voa", "https://projects.voanews.com/global2/", true),
            ("voa", "https://www.voanews.com/a/story/123.html", false),
            (
                "un-news",
                "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
                true,
            ),
            ("un-news", "https://news.un.org/en/story/2026/10/123", false),
            ("rest-of-world", "https://restofworld.org/feed/", true),
            (
                "rest-of-world",
                "https://restofworld.org/2026/story/",
                false,
            ),
            ("aeon", "https://aeon.co/feed", true),
            ("aeon", "https://aeon.co/essays/story", false),
            ("quanta", "https://www.quantamagazine.org/feed/", true),
            (
                "quanta",
                "https://www.quantamagazine.org/example-story-20261006/",
                false,
            ),
            (
                "works-in-progress",
                "https://worksinprogress.co/rss.xml",
                true,
            ),
            (
                "works-in-progress",
                "https://worksinprogress.co/issue/example/",
                false,
            ),
        ];
        for (source, url, is_feed) in cases {
            assert_eq!(
                validate_url(source, url).map(|(_, feed)| feed),
                Ok(is_feed),
                "{url}"
            );
        }
    }

    #[test]
    fn rejects_unknown_sources_hosts_paths_and_non_https_urls() {
        let cases = [
            ("unknown", "https://www.bbc.com/news/articles/example"),
            ("bbc", "https://example.com/news/example"),
            ("bbc", "http://www.bbc.com/news/example"),
            ("bbc", "file:///news/example"),
            ("bbc", "https://www.bbc.com.evil.test/news/example"),
            ("bbc", "https://www.bbc.com/sport/example"),
            ("bbc", "https://user:password@www.bbc.com/news/example"),
            ("bbc", "https://www.bbc.com:8443/news/example"),
            ("cgtn", "https://www.bbc.com/news/example"),
            ("rest-of-world", "https://restofworld.org/subscribe/example"),
            ("aeon", "https://aeon.co/about/example"),
            ("quanta", "https://www.quantamagazine.org/about/contact/"),
            (
                "works-in-progress",
                "https://worksinprogress.co/newsletter/example",
            ),
        ];
        for (source, url) in cases {
            assert!(validate_url(source, url).is_err(), "{source}: {url}");
        }
    }

    // Explicit opt-in only: upstream availability must never gate normal tests.
    #[tokio::test]
    #[ignore = "Live reading-source HTTP smoke test"]
    async fn live_official_sources() {
        for (source, url) in [
            ("bbc", "https://feeds.bbci.co.uk/news/world/rss.xml"),
            (
                "cgtn",
                "https://www.cgtn.com/subscribe/rss/section/world.xml",
            ),
            ("quanta", "https://www.quantamagazine.org/feed/"),
        ] {
            check_live_source(source, url).await;
        }
    }

    #[tokio::test]
    #[ignore = "Live Aeon feed redirect and article HTTP smoke test"]
    async fn live_aeon_feed_redirect() {
        check_live_source("aeon", "https://aeon.co/feed").await;
    }

    async fn check_live_source(source: &str, url: &str) {
        let response = reading_source(source.into(), url.into()).await.expect(url);
        eprintln!(
            "{source}: status={}, bytes={}, type={}",
            response.status,
            response.body.len(),
            response.content_type
        );
        assert_eq!(response.status, 200, "{url}");
        assert!(response.body.contains("<item>"), "{url}: RSS items missing");
        let links =
            regex::Regex::new(r"<item(?:\s[^>]*)?>[\s\S]*?<link>(?:<!\[CDATA\[)?([^<]+)").unwrap();
        // RSS can include regional hosts that the existing reading adapters exclude.
        let link = links
            .captures_iter(&response.body)
            .map(|capture| {
                capture[1]
                    .trim()
                    .trim_end_matches("]]>")
                    .replace("&amp;", "&")
            })
            .find(|link| validate_url(source, link).is_ok())
            .expect("Supported RSS article link");
        let article = reading_source(source.into(), link.clone())
            .await
            .expect(&link);
        eprintln!(
            "{source} article: status={}, bytes={}, url={link}",
            article.status,
            article.body.len()
        );
        assert_eq!(article.status, 200, "{link}");
        assert!(article.body.contains("<html"), "{link}: HTML missing");
    }
}
