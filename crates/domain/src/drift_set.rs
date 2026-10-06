//! Set comparison between what this build believes is deployed and what a scan saw remotely.
//!
//! ## Why this needs §19's completeness to exist at all
//!
//! "The remote list does not contain this path" is only evidence of absence if the list was
//! complete. Before `ScanCompleteness` existed, a listing that had been cut off at our own
//! 2000-file budget looked identical to one that had covered everything, so comparing against it
//! would have reported every file past the cut as missing - and a future caller reading that
//! report as an instruction would delete or re-upload content that is fine. This module's whole
//! job is to keep that inference honest: the completeness level decides which directions may be
//! concluded at all, and it is a parameter rather than something the caller can forget to check.
//! keep that inference honest: the completeness level decides which directions may be concluded at
//! all, and it is a parameter rather than something the caller can forget to check.
//!
//! ## Why the two directions are asymmetric
//!
//! Presence is witnessed; absence is only inferred from coverage. A path we did see in a partial
//! listing is real no matter how much else went unseen, so `UnrecordedRemote` is safe at every
//! level that returned any data. `MissingRemote` demands the opposite guarantee - that there was
//! nothing else to see - so it requires Complete and gets nothing otherwise. Making that asymmetry
//! explicit here is the point; the alternative was two call sites each remembering it separately.
//!
//! ## Why this is pure
//!
//! No pool, no provider, no async. The three levels and their combinations are enumerable in unit
//! tests, and a rule that can only be exercised against live storage is an unverified one.

use std::collections::HashSet;

/// What the local database claims about one deployment row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalBelief {
    pub deployment_id: uuid::Uuid,
    pub remote_path: String,
    /// True when the row says the object is live. Rows saying failed/pending are still beliefs -
    /// they just claim the opposite - which is what makes the second direction reachable.
    pub status_online: bool,
}

/// The remote side of the comparison, carrying how much of it we can trust.
///
/// Three shapes rather than a set plus a flag, because the flag could be forgotten while the shape
/// cannot: a caller holding `Partial` has no way to ask "may I conclude absence?" without
/// matching on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteSide {
    /// A complete sweep: these paths are everything there is.
    Complete(HashSet<String>),
    /// A sweep that stopped early: these paths are real, but more may exist unlisted.
    Partial(HashSet<String>),
    /// Nothing usable - the sweep failed, expired, or never ran. An empty set here would mean
    /// "the remote is empty", which is the loudest possible wrong answer.
    Untrusted,
}

impl RemoteSide {
    /// Paths the remote actually showed, regardless of coverage.
    pub fn observed(&self) -> Option<&HashSet<String>> {
        match self {
            RemoteSide::Complete(paths) | RemoteSide::Partial(paths) => Some(paths),
            RemoteSide::Untrusted => None,
        }
    }

    /// Whether absence may be concluded from this side. Delegates to the single domain rule.
    pub fn supports_absence_conclusion(&self) -> bool {
        matches!(self, RemoteSide::Complete(_))
    }
}

/// One finding of the set comparison.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetDriftKind {
    /// We believe it is online and a complete sweep did not see it.
    MissingRemote,
    /// The remote has a path no local row claims, online or otherwise.
    UnrecordedRemote,
    /// A local row disagrees with what we could see, and coverage was too weak to say how.
    UnknownCoverage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetDrift {
    /// None for `UnrecordedRemote`, which by definition has no local row yet.
    pub deployment_id: Option<uuid::Uuid>,
    pub kind: SetDriftKind,
    pub remote_path: String,
}

/// Compare local belief against a remote side.
///
/// Ordering: findings come out local-first (in the order `local` was given), then remote-only
/// paths sorted, so a report is deterministic and a diff of two reports means something.
///
/// Two local rows may name the same path (primary plus mirror on one storage is exactly that
/// case), and each still gets its own finding, because the repair decision is per row.
pub fn compare_sets(local: &[LocalBelief], remote: &RemoteSide) -> Vec<SetDrift> {
    let mut findings = Vec::new();

    // Paths any local row claims, whether or not that row thinks the object is live. A failed row
    // still records where the object was meant to be, so it counts as claimed for the purpose of
    // "is this remote path already known to us?".
    let claimed: HashSet<&str> = local.iter().map(|b| b.remote_path.as_str()).collect();

    for belief in local {
        let seen = remote
            .observed()
            .is_some_and(|paths| paths.contains(&belief.remote_path));
        if seen || !belief.status_online {
            // Either the remote confirms the row, or the row does not claim the object is live and
            // we have nothing to contradict it with. Both are agreement as far as this report
            // goes.
            continue;
        }
        // The row says online and the listing did not show it. What that means depends entirely on
        // coverage: only a complete sweep turns "not shown" into "not there".
        let kind = match remote {
            RemoteSide::Complete(_) => SetDriftKind::MissingRemote,
            // Absence inferred from a partial listing proves nothing - the path may sit past the
            // cut - and an untrusted side proves less still. Reporting either as missing is the
            // §19 failure this module exists to prevent.
            RemoteSide::Partial(_) | RemoteSide::Untrusted => SetDriftKind::UnknownCoverage,
        };
        findings.push(SetDrift {
            deployment_id: Some(belief.deployment_id),
            kind,
            remote_path: belief.remote_path.clone(),
        });
    }

    if let Some(paths) = remote.observed() {
        let mut unlisted: Vec<String> = paths
            .iter()
            .filter(|path| !claimed.contains(path.as_str()))
            .cloned()
            .collect();
        unlisted.sort();
        for path in unlisted {
            findings.push(SetDrift {
                deployment_id: None,
                kind: SetDriftKind::UnrecordedRemote,
                remote_path: path,
            });
        }
    }

    findings
}

/// Count of each kind, for a report line that must account for every finding.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DriftTally {
    pub missing_remote: usize,
    pub unrecorded_remote: usize,
    pub unknown_coverage: usize,
}

impl DriftTally {
    pub fn from_findings(findings: &[SetDrift]) -> Self {
        let mut tally = DriftTally::default();
        for finding in findings {
            match finding.kind {
                SetDriftKind::MissingRemote => tally.missing_remote += 1,
                SetDriftKind::UnrecordedRemote => tally.unrecorded_remote += 1,
                SetDriftKind::UnknownCoverage => tally.unknown_coverage += 1,
            }
        }
        tally
    }

    /// Every finding lands in exactly one bucket. If a kind were added and not counted here, a
    /// report would silently understate drift, so the identity is asserted rather than assumed.
    pub fn accounting_is_complete_for(&self, findings: &[SetDrift]) -> bool {
        self.missing_remote + self.unrecorded_remote + self.unknown_coverage == findings.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(items: &[&str]) -> HashSet<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }

    fn belief(path: &str, online: bool) -> LocalBelief {
        LocalBelief {
            deployment_id: uuid::Uuid::new_v4(),
            remote_path: path.to_string(),
            status_online: online,
        }
    }

    #[test]
    fn a_complete_sweep_that_omits_an_online_row_is_missing_remote() {
        let findings = compare_sets(
            &[belief("assets/a.png", true)],
            &RemoteSide::Complete(paths(&["assets/b.png"])),
        );
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, SetDriftKind::MissingRemote);
        assert_eq!(findings[0].remote_path, "assets/a.png");
    }

    #[test]
    fn a_partial_sweep_never_reports_missing_remote() {
        // THE gate for this module: the dangerous mis-inference is treating "past the cut" as
        // "gone". Same input as the previous test, different coverage level.
        let findings = compare_sets(
            &[belief("assets/a.png", true)],
            &RemoteSide::Partial(paths(&["assets/b.png"])),
        );
        assert!(
            !findings
                .iter()
                .any(|f| f.kind == SetDriftKind::MissingRemote),
            "a partial listing cannot prove absence: {findings:?}"
        );
        assert_eq!(findings[0].kind, SetDriftKind::UnknownCoverage);
    }

    #[test]
    fn an_untrusted_side_reports_unknown_instead_of_absence() {
        let findings = compare_sets(&[belief("assets/a.png", true)], &RemoteSide::Untrusted);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, SetDriftKind::UnknownCoverage);
    }

    #[test]
    fn a_remote_path_no_local_row_claims_is_unrecorded_at_every_usable_level() {
        // Presence is witnessed, so this direction survives a partial sweep. Asserted on both
        // levels: writing the branch for Complete only would leave the partial path silent.
        for remote in [
            RemoteSide::Complete(paths(&["assets/new.png"])),
            RemoteSide::Partial(paths(&["assets/new.png"])),
        ] {
            let findings = compare_sets(&[], &remote);
            assert_eq!(findings.len(), 1, "{remote:?}");
            assert_eq!(findings[0].kind, SetDriftKind::UnrecordedRemote);
            assert_eq!(
                findings[0].deployment_id, None,
                "there is no local row to attach this to"
            );
        }
    }

    #[test]
    fn an_untrusted_side_invents_no_unrecorded_paths() {
        // The empty-set trap: `Untrusted` holding nothing must not read as "the remote is empty",
        // which would produce zero findings and look like perfect agreement.
        let findings = compare_sets(&[belief("assets/a.png", false)], &RemoteSide::Untrusted);
        assert!(findings.is_empty());
        assert_eq!(
            RemoteSide::Untrusted.observed(),
            None,
            "untrusted must not expose a set to iterate"
        );
    }

    #[test]
    fn a_failed_row_matching_a_remote_path_agrees_rather_than_drifting() {
        let findings = compare_sets(
            &[belief("assets/a.png", false)],
            &RemoteSide::Complete(paths(&["assets/a.png"])),
        );
        assert!(
            !findings
                .iter()
                .any(|f| f.kind == SetDriftKind::UnrecordedRemote),
            "the path IS claimed; the disagreement is about status, not existence: {findings:?}"
        );
    }

    #[test]
    fn a_matching_online_row_produces_nothing() {
        let findings = compare_sets(
            &[belief("assets/a.png", true)],
            &RemoteSide::Complete(paths(&["assets/a.png"])),
        );
        assert!(
            findings.is_empty(),
            "agreement must be silent: {findings:?}"
        );
    }

    #[test]
    fn two_rows_on_one_path_each_get_their_own_finding() {
        // Primary + mirror on the same storage: the repair decision is per row.
        let findings = compare_sets(
            &[belief("assets/a.png", true), belief("assets/a.png", true)],
            &RemoteSide::Complete(paths(&[])),
        );
        assert_eq!(findings.len(), 2);
        assert!(
            findings
                .iter()
                .all(|f| f.kind == SetDriftKind::MissingRemote)
        );
    }

    #[test]
    fn remote_only_paths_come_out_sorted() {
        let findings = compare_sets(
            &[],
            &RemoteSide::Complete(paths(&["z.png", "a.png", "m.png"])),
        );
        let listed: Vec<&str> = findings.iter().map(|f| f.remote_path.as_str()).collect();
        assert_eq!(listed, vec!["a.png", "m.png", "z.png"]);
    }

    #[test]
    fn the_tally_accounts_for_every_finding_and_names_none_twice() {
        let findings = compare_sets(
            &[belief("gone.png", true), belief("dim.png", true)],
            &RemoteSide::Partial(paths(&["fresh.png", "dim.png"])),
        );
        let tally = DriftTally::from_findings(&findings);
        assert!(tally.accounting_is_complete_for(&findings));
        assert_eq!(tally.unrecorded_remote, 1);
        assert_eq!(tally.unknown_coverage, 1);
        assert_eq!(
            tally.missing_remote, 0,
            "a partial sweep must not contribute to the missing count"
        );
    }

    #[test]
    fn the_tally_rejects_a_bucket_that_was_never_filled() {
        // Guards the identity itself: a new kind that forgot to increment would break this rather
        // than vanish from the report.
        let findings = compare_sets(
            &[belief("gone.png", true)],
            &RemoteSide::Complete(paths(&[])),
        );
        let broken = DriftTally {
            missing_remote: 0,
            unrecorded_remote: 0,
            unknown_coverage: 0,
        };
        assert!(findings.len() == 1);
        assert!(!broken.accounting_is_complete_for(&findings));
    }

    #[test]
    fn only_the_complete_shape_supports_an_absence_conclusion() {
        assert!(RemoteSide::Complete(paths(&[])).supports_absence_conclusion());
        assert!(!RemoteSide::Partial(paths(&[])).supports_absence_conclusion());
        assert!(!RemoteSide::Untrusted.supports_absence_conclusion());
    }
}
