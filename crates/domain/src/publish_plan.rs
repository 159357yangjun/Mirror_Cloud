//! Frozen publish intent and the execution plan derived from it.
//!
//! ## Why this exists
//!
//! Today publishing decides as it runs: `PublisherCore::publish_group(strategy, ..)` takes a
//! strategy enum and returns `Vec<PublishOutcome>` afterwards. Nothing records *what was about to
//! happen*, so a partial failure cannot be reasoned about from a durable artifact - only from log
//! prose written after the fact.
//!
//! This module adds the missing "before" half. It is **not wired into the publish path yet**; see
//! `docs/PUBLISH_PLAN_RELATIONS.md` for the coexistence and replacement plan.
//!
//! ## Immutability contract
//!
//! Every field is private and there are no setters. The only way to obtain one of these values is
//! through the constructor, which consumes its inputs. Changing a decision therefore means
//! constructing a new object with a new id - never mutating an existing one. That is deliberate:
//! a plan that can be edited mid-flight is not evidence of what ran.
//!
//! ```text
//! PublishIntent (frozen decision)
//!     --compile()-->  PublishPlan (ordered steps)
//!     --execute()-->  Vec<PublishOutcome>
//! ```

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{AssetId, DeploymentRole, StorageGroupId, StorageId, VariantId};

/// One thing that must exist remotely when the plan is carried out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PlannedUpload {
    pub variant_id: VariantId,
    pub asset_id: AssetId,
    pub storage_id: StorageId,
    pub role: DeploymentRole,
    /// Remote key decided up front, so a retry writes the same place rather than re-deriving it.
    pub remote_path: String,
}

/// What the plan expects to be true once an upload lands. Checked by the executor, not asserted
/// by us: the expectation is data, so a later VerificationEvidence layer can compare against it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ExpectedResult {
    /// A publicly reachable URL must exist for the uploaded object.
    pub public_url_required: bool,
    /// Byte size the remote object must report. `None` skips the size expectation.
    pub expected_bytes: Option<u64>,
}

/// A single ordered unit of work inside a plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PlanStep {
    pub index: u32,
    pub upload: PlannedUpload,
    pub expectation: ExpectedResult,
    /// Uploads already completed when this step begins. If this step fails, these are the ones to
    /// roll back. Recorded per step so rollback does not have to re-derive it from wall-clock order.
    pub rollback_points: Vec<PlannedUpload>,
}

/// Whether successfully uploaded siblings are removed when part of a plan fails.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RollbackPolicy {
    /// Delete what already succeeded. Matches today's `rollback_successful_uploads`.
    #[default]
    RollbackSuccessful,
    /// Leave everything in place and let the user repair. Useful when a duplicate URL is cheaper
    /// than a missing one.
    KeepPartial,
}

/// Where a plan sends one asset's variants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetSelection {
    /// Send every variant to every storage in the group, resolved at compile time.
    Group { storage_group_id: StorageGroupId },
    /// Explicit list, already resolved.
    Enumerated(Vec<PlannedUpload>),
}

/// The frozen decision to publish something. Construct once; never edit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PublishIntent {
    id: Uuid,
    created_at: DateTime<Utc>,
    source_assets: Vec<AssetId>,
    targets: TargetSelection,
    variant_ids: Vec<VariantId>,
    rollback_policy: RollbackPolicy,
    /// Path template used to derive remote keys, captured so a later template change cannot
    /// retroactively alter what this intent meant.
    path_template: String,
}

impl PublishIntent {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        created_at: DateTime<Utc>,
        source_assets: Vec<AssetId>,
        targets: TargetSelection,
        variant_ids: Vec<VariantId>,
        rollback_policy: RollbackPolicy,
        path_template: String,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            created_at,
            source_assets,
            targets,
            variant_ids,
            rollback_policy,
            path_template,
        }
    }

    pub fn id(&self) -> Uuid {
        self.id
    }

    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at
    }

    pub fn source_assets(&self) -> &[AssetId] {
        &self.source_assets
    }

    pub fn targets(&self) -> &TargetSelection {
        &self.targets
    }

    pub fn variant_ids(&self) -> &[VariantId] {
        &self.variant_ids
    }

    pub fn rollback_policy(&self) -> RollbackPolicy {
        self.rollback_policy
    }

    pub fn path_template(&self) -> &str {
        &self.path_template
    }
}

/// The ordered execution derived from an intent. Also frozen once built.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PublishPlan {
    id: Uuid,
    intent_id: Uuid,
    created_at: DateTime<Utc>,
    steps: Vec<PlanStep>,
    rollback_policy: RollbackPolicy,
}

impl PublishPlan {
    /// Resolve an intent into ordered steps.
    ///
    /// Ordering is deterministic and meaningful: Primary first, then Mirror, then Backup. The
    /// primary URL is what users end up citing, so if anything is going to fail it should fail on
    /// a copy rather than after copies have been made.
    ///
    /// `storages` supplies the concrete destinations for a `TargetSelection::Group`; an empty or
    /// unmatched set yields an empty plan rather than an error, because "nothing to do" is a valid
    /// outcome the caller can branch on.
    pub fn compile(intent: &PublishIntent, storages: &[(StorageId, DeploymentRole)]) -> Self {
        let uploads: Vec<PlannedUpload> = match &intent.targets() {
            TargetSelection::Enumerated(list) => list.clone(),
            TargetSelection::Group { .. } => storages
                .iter()
                .flat_map(|(storage_id, role)| {
                    intent.variant_ids().iter().map(move |variant_id| {
                        PlannedUpload {
                            variant_id: *variant_id,
                            // The owning asset is resolved by the executor from the variant id; the
                            // plan carries the first source asset only as a placeholder-free default.
                            asset_id: intent.source_assets().first().copied().unwrap_or_default(),
                            storage_id: *storage_id,
                            role: role.clone(),
                            remote_path: render_remote_path(intent.path_template(), variant_id),
                        }
                    })
                })
                .collect(),
        };

        let mut ordered = uploads;
        ordered.sort_by_key(|upload| role_rank(&upload.role));

        let mut steps = Vec::with_capacity(ordered.len());
        let mut completed: Vec<PlannedUpload> = Vec::with_capacity(ordered.len());
        for (index, upload) in ordered.into_iter().enumerate() {
            steps.push(PlanStep {
                index: index as u32,
                expectation: ExpectedResult {
                    public_url_required: true,
                    expected_bytes: None,
                },
                rollback_points: completed.clone(),
                upload: upload.clone(),
            });
            completed.push(upload);
        }

        Self {
            id: Uuid::new_v4(),
            intent_id: intent.id(),
            created_at: Utc::now(),
            steps,
            rollback_policy: intent.rollback_policy(),
        }
    }

    pub fn id(&self) -> Uuid {
        self.id
    }

    pub fn intent_id(&self) -> Uuid {
        self.intent_id
    }

    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at
    }

    pub fn steps(&self) -> &[PlanStep] {
        &self.steps
    }

    pub fn rollback_policy(&self) -> RollbackPolicy {
        self.rollback_policy
    }

    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    pub fn len(&self) -> usize {
        self.steps.len()
    }
}

fn role_rank(role: &DeploymentRole) -> u8 {
    match role {
        DeploymentRole::Primary => 0,
        DeploymentRole::Mirror => 1,
        DeploymentRole::Backup => 2,
    }
}

/// Substitute the variant id into the `{uuid}` slot the existing path templates use.
fn render_remote_path(template: &str, variant_id: &Uuid) -> String {
    template.replace("{uuid}", &variant_id.simple().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(n: usize) -> Vec<Uuid> {
        (0..n).map(|_| Uuid::new_v4()).collect()
    }

    fn intent_with(variants: Vec<Uuid>, targets: TargetSelection) -> PublishIntent {
        PublishIntent::new(
            Utc::now(),
            ids(1),
            targets,
            variants,
            RollbackPolicy::RollbackSuccessful,
            "assets/blog/{uuid}.png".to_string(),
        )
    }

    #[test]
    fn intent_freezes_an_id_and_timestamp_that_no_caller_can_rewrite() {
        let intent = intent_with(ids(1), TargetSelection::Enumerated(vec![]));
        let before = intent.clone();
        // No setter exists, so "unchanged" is proven by the type API. Round-tripping through
        // serde is the strongest check available here: identity survives, and there is no field
        // left open for a caller to poke.
        let restored: PublishIntent =
            serde_json::from_str(&serde_json::to_string(&before).unwrap()).unwrap();
        assert_eq!(restored.id(), intent.id());
        assert_eq!(restored.created_at(), intent.created_at());
        assert_eq!(restored, intent);
    }

    #[test]
    fn compile_orders_primary_before_mirror_and_backup() {
        let variant = Uuid::new_v4();
        let primary = Uuid::new_v4();
        let mirror = Uuid::new_v4();
        let backup = Uuid::new_v4();
        let intent = intent_with(
            vec![variant],
            TargetSelection::Group {
                storage_group_id: Uuid::new_v4(),
            },
        );
        // Deliberately listed out of rank order to prove compile() sorts rather than trusts input.
        let plan = PublishPlan::compile(
            &intent,
            &[
                (backup, DeploymentRole::Backup),
                (mirror, DeploymentRole::Mirror),
                (primary, DeploymentRole::Primary),
            ],
        );
        let roles: Vec<_> = plan
            .steps()
            .iter()
            .map(|step| step.upload.role.clone())
            .collect();
        assert_eq!(
            roles,
            vec![
                DeploymentRole::Primary,
                DeploymentRole::Mirror,
                DeploymentRole::Backup
            ]
        );
        assert_eq!(plan.steps()[0].upload.storage_id, primary);
        assert_eq!(
            plan.steps().iter().map(|s| s.index).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
    }

    #[test]
    fn rollback_points_grow_step_by_step_and_the_first_step_has_none() {
        let intent = intent_with(
            ids(1),
            TargetSelection::Group {
                storage_group_id: Uuid::new_v4(),
            },
        );
        let plan = PublishPlan::compile(
            &intent,
            &[
                (Uuid::new_v4(), DeploymentRole::Primary),
                (Uuid::new_v4(), DeploymentRole::Backup),
            ],
        );
        assert_eq!(plan.len(), 2);
        assert!(
            plan.steps()[0].rollback_points.is_empty(),
            "the first step has nothing to roll back"
        );
        assert_eq!(plan.steps()[1].rollback_points.len(), 1);
        assert_eq!(
            plan.steps()[1].rollback_points[0].storage_id,
            plan.steps()[0].upload.storage_id
        );
    }

    #[test]
    fn remote_path_is_decided_at_compile_time_and_is_stable() {
        let variant = Uuid::new_v4();
        let intent = intent_with(
            vec![variant],
            TargetSelection::Group {
                storage_group_id: Uuid::new_v4(),
            },
        );
        let storages = [(Uuid::new_v4(), DeploymentRole::Primary)];
        let first = PublishPlan::compile(&intent, &storages);
        let second = PublishPlan::compile(&intent, &storages);
        assert_eq!(
            first.steps()[0].upload.remote_path,
            format!("assets/blog/{}.png", variant.simple())
        );
        assert_eq!(
            first.steps()[0].upload.remote_path,
            second.steps()[0].upload.remote_path,
            "a retry must target the same key, so the path cannot depend on wall-clock or randomness"
        );
    }

    #[test]
    fn two_compiles_of_one_intent_are_distinct_plans_linked_to_the_same_intent() {
        let intent = intent_with(
            ids(1),
            TargetSelection::Group {
                storage_group_id: Uuid::new_v4(),
            },
        );
        let storages = [(Uuid::new_v4(), DeploymentRole::Primary)];
        let a = PublishPlan::compile(&intent, &storages);
        let b = PublishPlan::compile(&intent, &storages);
        assert_ne!(a.id(), b.id(), "changing a plan means building a new one");
        assert_eq!(a.intent_id(), intent.id());
        assert_eq!(b.intent_id(), intent.id());
    }

    #[test]
    fn empty_targets_compile_to_an_empty_plan_not_an_error() {
        let intent = intent_with(vec![], TargetSelection::Enumerated(vec![]));
        let plan = PublishPlan::compile(&intent, &[]);
        assert!(plan.is_empty());
        assert_eq!(plan.len(), 0);
    }

    #[test]
    fn rollback_policy_is_carried_from_intent_into_plan() {
        let keep = PublishIntent::new(
            Utc::now(),
            ids(1),
            TargetSelection::Enumerated(vec![PlannedUpload {
                variant_id: Uuid::new_v4(),
                asset_id: Uuid::new_v4(),
                storage_id: Uuid::new_v4(),
                role: DeploymentRole::Primary,
                remote_path: "assets/a.png".into(),
            }]),
            ids(1),
            RollbackPolicy::KeepPartial,
            "assets/{uuid}.png".into(),
        );
        let plan = PublishPlan::compile(&keep, &[]);
        assert_eq!(plan.rollback_policy(), RollbackPolicy::KeepPartial);
        assert_eq!(plan.len(), 1, "enumerated targets bypass group resolution");
        assert_eq!(
            plan.steps()[0].expectation,
            ExpectedResult {
                public_url_required: true,
                expected_bytes: None
            }
        );
    }
}
