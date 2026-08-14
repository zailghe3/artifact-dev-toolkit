use reqwest::{header, ClientBuilder, Version};
use serde::Serialize;
use std::{
    error::Error,
    io,
    net::{SocketAddr, ToSocketAddrs},
    time::Duration,
};
const HOST: &str = "auth.openai.com";
const URL: &str = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const MALFORMED_BODY: &str = "{";
const VALID_JSON_EMPTY_CLIENT_BODY: &str = r#"{"client_id":""}"#;
const TIMEOUT: Duration = Duration::from_secs(4);
#[derive(Clone, Copy)]
enum Variant {
    Baseline,
    ValidJsonEmptyClient,
    NamedUserAgent,
    Http1Only,
    NoProxy,
    ForcedIpv4,
}
impl Variant {
    fn name(self) -> &'static str {
        match self {
            Self::Baseline => "baseline",
            Self::ValidJsonEmptyClient => "validJsonEmptyClient",
            Self::NamedUserAgent => "namedUserAgent",
            Self::Http1Only => "http1Only",
            Self::NoProxy => "noProxy",
            Self::ForcedIpv4 => "forcedIpv4",
        }
    }
}
#[derive(Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "outcome"
)]
enum ResultSummary {
    #[serde(rename = "http_response")]
    Http {
        status: u16,
        protocol: &'static str,
        cloudflare_edge: bool,
        mitigation_challenge: bool,
        content_kind: &'static str,
    },
    #[serde(rename = "transport_error")]
    Transport {
        is_timeout: bool,
        is_connect: bool,
        is_request: bool,
        io_error_kind: &'static str,
        tls_source_present: bool,
        source_class: &'static str,
    },
}
#[derive(Serialize)]
struct Entry {
    variant: &'static str,
    result: ResultSummary,
}
#[derive(Serialize)]
struct Output {
    attempts: Vec<Entry>,
}
fn builder(variant: Variant, ipv4: &[SocketAddr]) -> ClientBuilder {
    let mut b = ClientBuilder::new().timeout(TIMEOUT);
    match variant {
        Variant::Baseline | Variant::ValidJsonEmptyClient => {}
        Variant::NamedUserAgent => {
            b = b.user_agent(format!(
                "ADT-Codex-Auth-Probe/{}",
                env!("CARGO_PKG_VERSION")
            ))
        }
        Variant::Http1Only => b = b.http1_only(),
        Variant::NoProxy => b = b.no_proxy(),
        Variant::ForcedIpv4 => b = b.resolve_to_addrs(HOST, ipv4),
    }
    b
}
fn io_kind(kind: io::ErrorKind) -> &'static str {
    match kind {
        io::ErrorKind::NetworkUnreachable => "network_unreachable",
        io::ErrorKind::HostUnreachable => "host_unreachable",
        io::ErrorKind::ConnectionRefused => "connection_refused",
        io::ErrorKind::ConnectionReset => "connection_reset",
        io::ErrorKind::TimedOut => "timed_out",
        io::ErrorKind::AddrNotAvailable => "address_not_available",
        _ => "other",
    }
}
fn classify(error: &reqwest::Error) -> ResultSummary {
    let mut source = error.source();
    let mut kind = "none";
    let mut class = "unknown";
    let mut tls = false;
    while let Some(current) = source {
        if let Some(e) = current.downcast_ref::<io::Error>() {
            kind = io_kind(e.kind());
            class = "io"
        } else if current.downcast_ref::<native_tls::Error>().is_some() {
            tls = true;
            class = "tls"
        }
        source = current.source()
    }
    ResultSummary::Transport {
        is_timeout: error.is_timeout(),
        is_connect: error.is_connect(),
        is_request: error.is_request(),
        io_error_kind: kind,
        tls_source_present: tls,
        source_class: class,
    }
}
fn follow_ups(result: &ResultSummary) -> &'static [Variant] {
    if matches!(result, ResultSummary::Http { .. }) {
        &[Variant::ValidJsonEmptyClient]
    } else {
        &[
            Variant::NamedUserAgent,
            Variant::Http1Only,
            Variant::NoProxy,
            Variant::ForcedIpv4,
        ]
    }
}
async fn attempt(variant: Variant, ipv4: &[SocketAddr]) -> Entry {
    let result = match builder(variant, ipv4).build() {
        Ok(client) => match client
            .post(URL)
            .header(header::CONTENT_TYPE, "application/json")
            .body(if matches!(variant, Variant::ValidJsonEmptyClient) {
                VALID_JSON_EMPTY_CLIENT_BODY
            } else {
                MALFORMED_BODY
            })
            .send()
            .await
        {
            Ok(response) => {
                let h = response.headers();
                let content = h
                    .get(header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(|v| v.split(';').next().unwrap_or("").trim());
                ResultSummary::Http {
                    status: response.status().as_u16(),
                    protocol: match response.version() {
                        Version::HTTP_11 | Version::HTTP_10 => "http1",
                        Version::HTTP_2 => "http2",
                        _ => "unknown",
                    },
                    cloudflare_edge: h
                        .get(header::SERVER)
                        .and_then(|v| v.to_str().ok())
                        .is_some_and(|v| v.eq_ignore_ascii_case("cloudflare")),
                    mitigation_challenge: h.get("cf-mitigated").and_then(|v| v.to_str().ok())
                        == Some("challenge"),
                    content_kind: match content {
                        Some("application/json") => "json",
                        Some("text/html") => "html",
                        Some(_) => "other",
                        None => "unknown",
                    },
                }
            }
            Err(e) => classify(&e),
        },
        Err(e) => classify(&e),
    };
    Entry {
        variant: variant.name(),
        result,
    }
}
#[tokio::main]
async fn main() {
    let ipv4: Vec<_> = (HOST, 443)
        .to_socket_addrs()
        .map(|v| v.filter(SocketAddr::is_ipv4).collect())
        .unwrap_or_default();
    let mut attempts = vec![attempt(Variant::Baseline, &ipv4).await];
    for &variant in follow_ups(&attempts[0].result) {
        attempts.push(attempt(variant, &ipv4).await)
    }
    println!(
        "{}",
        serde_json::to_string(&Output { attempts }).expect("bounded output serializes")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn progressive_request_budget_selects_exact_follow_ups() {
        let http = ResultSummary::Http {
            status: 400,
            protocol: "http1",
            cloudflare_edge: false,
            mitigation_challenge: false,
            content_kind: "json",
        };
        assert_eq!(
            follow_ups(&http)
                .iter()
                .map(|v| v.name())
                .collect::<Vec<_>>(),
            ["validJsonEmptyClient"]
        );
        let transport = ResultSummary::Transport {
            is_timeout: false,
            is_connect: true,
            is_request: true,
            io_error_kind: "other",
            tls_source_present: false,
            source_class: "unknown",
        };
        assert_eq!(
            follow_ups(&transport)
                .iter()
                .map(|v| v.name())
                .collect::<Vec<_>>(),
            ["namedUserAgent", "http1Only", "noProxy", "forcedIpv4"]
        );
    }
    #[test]
    fn valid_json_control_is_exact_and_non_ceremony() {
        assert_eq!(VALID_JSON_EMPTY_CLIENT_BODY, r#"{"client_id":""}"#);
        assert!(!VALID_JSON_EMPTY_CLIENT_BODY.contains('\\'));

        let parsed: serde_json::Value =
            serde_json::from_str(VALID_JSON_EMPTY_CLIENT_BODY).expect("control body is valid JSON");
        assert_eq!(parsed, json!({"client_id": ""}));
        assert_eq!(
            parsed.as_object().expect("control body is an object").len(),
            1
        );

        for unsafe_field in [
            "device_id",
            "user_code",
            "token",
            "credential",
            "client_secret",
            "authorization_code",
        ] {
            assert!(!VALID_JSON_EMPTY_CLIENT_BODY.contains(unsafe_field));
        }

        let escaped_raw_string_regression = r#"{\"client_id\":\"\"}"#;
        assert_ne!(escaped_raw_string_regression, VALID_JSON_EMPTY_CLIENT_BODY);
        assert!(serde_json::from_str::<serde_json::Value>(escaped_raw_string_regression).is_err());
    }
    #[test]
    fn serializes_http_fields_in_canonical_camel_case() {
        let value = serde_json::to_value(ResultSummary::Http {
            status: 400,
            protocol: "http2",
            cloudflare_edge: true,
            mitigation_challenge: false,
            content_kind: "json",
        })
        .unwrap();
        assert_eq!(
            value,
            json!({"outcome":"http_response","status":400,"protocol":"http2","cloudflareEdge":true,"mitigationChallenge":false,"contentKind":"json"})
        );
        assert_no_snake_case(&value)
    }
    #[test]
    fn serializes_transport_fields_in_canonical_camel_case() {
        let value = serde_json::to_value(ResultSummary::Transport {
            is_timeout: true,
            is_connect: true,
            is_request: false,
            io_error_kind: "timed_out",
            tls_source_present: false,
            source_class: "io",
        })
        .unwrap();
        assert_eq!(
            value,
            json!({"outcome":"transport_error","isTimeout":true,"isConnect":true,"isRequest":false,"ioErrorKind":"timed_out","tlsSourcePresent":false,"sourceClass":"io"})
        );
        assert_no_snake_case(&value)
    }
    fn assert_no_snake_case(value: &serde_json::Value) {
        let text = value.to_string();
        for key in [
            "cloudflare_edge",
            "mitigation_challenge",
            "content_kind",
            "is_timeout",
            "is_connect",
            "is_request",
            "io_error_kind",
            "tls_source_present",
            "source_class",
        ] {
            assert!(!text.contains(key), "unexpected snake_case key: {key}")
        }
    }
}
