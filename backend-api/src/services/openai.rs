//! What every OpenAI client in the backend shares: the Responses API endpoint,
//! the request timeout, and reading a 429's headers for how long to wait.

use std::time::Duration;

use reqwest::header::HeaderMap;

pub const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
pub const OPENAI_HTTP_TIMEOUT_SECS: u64 = 60;

/// A header's value as a string, when it is there and is not binary.
fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name)?.to_str().ok()
}

/// Parses one of OpenAI's rate limit reset headers, which are written as
/// concatenated value and unit parts: `1s`, `88ms`, `6m0s`, `1h2m3s`.
///
/// Returns `None` for anything that does not parse, including a bare number, since a
/// reset window with no unit is not a shape OpenAI sends.
fn parse_reset_duration(value: &str) -> Option<Duration> {
    let mut rest = value.trim();
    if rest.is_empty() {
        return None;
    }

    let mut total = Duration::ZERO;
    while !rest.is_empty() {
        // the number, which openai can write with a decimal point
        let unit_start = rest.find(|c: char| !c.is_ascii_digit() && c != '.')?;
        let (number, after) = rest.split_at(unit_start);
        let number: f64 = number.parse().ok()?;

        // longest unit first, so `ms` is never read as `m` with a stray `s` after it
        let (secs_per_unit, unit_len) = match after {
            _ if after.starts_with("ms") => (0.001, 2),
            _ if after.starts_with('h') => (3600.0, 1),
            _ if after.starts_with('m') => (60.0, 1),
            _ if after.starts_with('s') => (1.0, 1),
            _ => return None,
        };

        total += Duration::try_from_secs_f64(number * secs_per_unit).ok()?;
        rest = &after[unit_len..];
    }

    Some(total)
}

/// How long OpenAI's headers say to wait before asking again, when they say anything.
///
/// `retry-after` is plain seconds and wins when it is there. Otherwise the two reset
/// headers say when each bucket refills, and the longer of the two is when both are
/// usable again. A response carrying none of them gives `None`, which means rate
/// limited with no stated wait rather than not rate limited.
pub fn rate_limit_wait(headers: &HeaderMap) -> Option<Duration> {
    if let Some(secs) =
        header_str(headers, "retry-after").and_then(|value| value.trim().parse::<u64>().ok())
    {
        return Some(Duration::from_secs(secs));
    }

    let requests = header_str(headers, "x-ratelimit-reset-requests").and_then(parse_reset_duration);
    let tokens = header_str(headers, "x-ratelimit-reset-tokens").and_then(parse_reset_duration);
    requests.max(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderName, HeaderValue};

    /// the headers of a 429, built from name and value pairs
    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs {
            headers.insert(
                HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        headers
    }

    #[test]
    fn parse_reset_duration_reads_openais_unit_format() {
        assert_eq!(parse_reset_duration("1s"), Some(Duration::from_secs(1)));
        assert_eq!(parse_reset_duration("6m0s"), Some(Duration::from_secs(360)));
        assert_eq!(
            parse_reset_duration("1h2m3s"),
            Some(Duration::from_secs(3723))
        );
        assert_eq!(parse_reset_duration(" 30s "), Some(Duration::from_secs(30)));
    }

    /// `ms` has to win over `m`, or an 88 millisecond wait reads as 88 minutes
    #[test]
    fn parse_reset_duration_does_not_read_ms_as_minutes() {
        assert_eq!(
            parse_reset_duration("88ms"),
            Some(Duration::from_millis(88))
        );
        assert_eq!(
            parse_reset_duration("1m500ms"),
            Some(Duration::from_millis(60_500))
        );
    }

    #[test]
    fn parse_reset_duration_rejects_what_it_cannot_read() {
        // a bare number has no unit, and the rest are not shapes openai sends
        for bad in ["", "   ", "30", "soon", "1d", "s", "1x", "1s2"] {
            assert_eq!(parse_reset_duration(bad), None, "expected None for {bad:?}");
        }
    }

    #[test]
    fn rate_limit_wait_prefers_retry_after() {
        let wait = rate_limit_wait(&headers(&[
            ("retry-after", "12"),
            ("x-ratelimit-reset-requests", "5m"),
        ]));

        assert_eq!(wait, Some(Duration::from_secs(12)));
    }

    /// both buckets have to refill before the next call can work, so the longer wait wins
    #[test]
    fn rate_limit_wait_takes_the_longer_reset_window() {
        let wait = rate_limit_wait(&headers(&[
            ("x-ratelimit-reset-requests", "2s"),
            ("x-ratelimit-reset-tokens", "6m0s"),
        ]));

        assert_eq!(wait, Some(Duration::from_secs(360)));
    }

    /// a rate limit with nothing readable about the wait is still a rate limit. the
    /// caller decides how long to stand down
    #[test]
    fn rate_limit_wait_is_none_when_the_headers_say_nothing() {
        assert_eq!(rate_limit_wait(&headers(&[])), None);
        assert_eq!(
            rate_limit_wait(&headers(&[("x-ratelimit-reset-requests", "whenever")])),
            None
        );
    }
}
