//! §18B: the four words a failed reconciliation probe is reported with.
//!
//! This taxonomy is deliberately coarser than [`StorageErrorKind`]: that one drives upload retry
//! policy and has eight members; this one answers a single user question - "why could the sweep not
//! tell me about this object?" - in a form short enough to sit in a table column. The mapping is
//! hardcoded here rather than configurable for the same reason the ladder tiers are: a user-tunable
//! classifier would make yesterday's stored records unreadable after today's edit.

use serde::Serialize;

/// One of the four display buckets, plus `unavailable` for "we never got to try".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbeFailureKind {
    /// No verdict was ever received: connection, DNS, TLS, timeout, or an upstream 5xx.
    NetworkTimeout,
    /// The provider refused us on identity or scope grounds (401/403).
    AuthFailed,
    /// The request itself was refused for a reason we can name but not act on remotely.
    Rejected,
    /// There was no usable provider at all - disabled storage, unreadable credential. Distinct
    /// from the others because zero requests went out, which changes what the user should do.
    Unavailable,
}

impl ProbeFailureKind {
    pub const ALL: [ProbeFailureKind; 4] = [
        ProbeFailureKind::NetworkTimeout,
        ProbeFailureKind::AuthFailed,
        ProbeFailureKind::Rejected,
        ProbeFailureKind::Unavailable,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            ProbeFailureKind::NetworkTimeout => "network_timeout",
            ProbeFailureKind::AuthFailed => "auth_failed",
            ProbeFailureKind::Rejected => "rejected",
            ProbeFailureKind::Unavailable => "unavailable",
        }
    }

    /// Sort a storage-layer error into the four buckets.
    ///
    /// Every arm names why it lands where it does; anything unclassifiable must land on
    /// `Rejected`, whose UI hint says "read the raw message" - the only advice that is correct
    /// for an unknown failure. Guessing `network_timeout` would tell people to wait when the
    /// fix is in their settings.
    pub fn classify(error_kind: crate::StorageErrorKind, message: &str) -> Self {
        use crate::StorageErrorKind;
        match error_kind {
            StorageErrorKind::Authentication => ProbeFailureKind::AuthFailed,
            StorageErrorKind::Network => ProbeFailureKind::NetworkTimeout,
            // A 404 during a probe is the answer, not a failure - callers route Ok(false) away
            // from here entirely. If one arrives anyway (an adapter that folded NotFound into a
            // rejection), the status text decides, same rule as the upload path.
            StorageErrorKind::NotFound => ProbeFailureKind::Rejected,
            StorageErrorKind::RateLimited => ProbeFailureKind::NetworkTimeout,
            StorageErrorKind::Conflict => ProbeFailureKind::NetworkTimeout,
            StorageErrorKind::Unsupported | StorageErrorKind::NotImplemented => {
                ProbeFailureKind::Unavailable
            }
            StorageErrorKind::Rejected => {
                let folded = message.to_ascii_lowercase();
                if folded.contains("401")
                    || folded.contains("403")
                    || folded.contains("unauthorized")
                {
                    ProbeFailureKind::AuthFailed
                } else {
                    ProbeFailureKind::Rejected
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::StorageErrorKind;

    #[test]
    fn every_member_round_trips_through_its_display_name() {
        for kind in ProbeFailureKind::ALL {
            assert_eq!(ProbeFailureKind::ALL.contains(&kind), true);
            let json = serde_json::to_value(kind).expect("serialises");
            assert_eq!(json.as_str(), Some(kind.as_str()), "{kind:?}");
        }
    }

    #[test]
    fn authentication_and_network_land_where_the_user_can_act() {
        assert_eq!(
            ProbeFailureKind::classify(StorageErrorKind::Authentication, "bad token"),
            ProbeFailureKind::AuthFailed
        );
        assert_eq!(
            ProbeFailureKind::classify(StorageErrorKind::Network, "connection reset"),
            ProbeFailureKind::NetworkTimeout
        );
    }

    #[test]
    fn an_unclassified_rejection_stays_rejected_rather_than_becoming_a_wait() {
        // Mislabelling an unknown refusal as network_timeout would tell the user to wait;
        // `rejected`'s hint tells them to read the message, which is always correct.
        assert_eq!(
            ProbeFailureKind::classify(StorageErrorKind::Rejected, "quota exhausted"),
            ProbeFailureKind::Rejected
        );
        // ...but a rejection carrying a status the adapter embedded reads as auth.
        assert_eq!(
            ProbeFailureKind::classify(StorageErrorKind::Rejected, "HTTP 403 forbidden"),
            ProbeFailureKind::AuthFailed
        );
    }

    #[test]
    fn unsupported_operations_report_as_unavailable_not_as_refused() {
        assert_eq!(
            ProbeFailureKind::classify(StorageErrorKind::Unsupported, ""),
            ProbeFailureKind::Unavailable
        );
        assert_eq!(
            ProbeFailureKind::classify(StorageErrorKind::NotImplemented, ""),
            ProbeFailureKind::Unavailable
        );
    }
}
