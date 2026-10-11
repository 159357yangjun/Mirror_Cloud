# Upload dialog: failed-source-only republish

The upload dialog previously offered a generic “重试” action after **any**
failure in a mixed upload batch. This cleared the task list and submitted the
entire original selection again, including successful images. In a multi-cloud
workflow it could produce duplicate remote writes and confusing resource
history.

The new action records the exact workflow ID, upload mode, original input order
and task IDs at dispatch. Rust's `publish_files_with_workflow` and
`publish_urls_with_workflow` both create one task per submitted input in
order. After **all** task IDs reach terminal states, the dialog permits
explicitly confirmed republishing of *only* the inputs whose latest task
status is `failed`. It maps replacement task IDs back into those positions
and preserves successful/completed-with-warning task IDs in the view. Task
history itself is never deleted.

Safeguards:

- A failed-only retry is disabled until the entire latest batch has ended.
  Success, warning, cancellation and still-running tasks are not resubmitted.
- The confirmation warns that a `failed` task may already have written to
  some remote targets or advanced beyond uploading; repeated publication may
  still create duplicates. The user should check Tasks and Assets first.
- Clipboard publishing is deliberately excluded. Re-reading a changed
  clipboard would not be a retry of the same bytes. Users may start a separate,
  intentional clipboard publication instead.
- The original workflow identifier is reused, not a newly selected default
  target. This does not imply that a workflow subsequently edited in the DB
  is frozen; operator confirmation remains necessary.
- When backend task creation fails, the UI never claims that nothing was
  dispatched. It instructs the operator to inspect Tasks before trying again.
- UI completion is based on the latest task ID for each original source.
  Partial successes are not silently recounted as failures or re-published.

The existing `retry_task` backend command is **only** for Cloud Manager
batch tasks; this UI does not misuse it for `workflow_publish` or
`workflow_url_publish`.

Real cloud idempotency and Windows manual acceptance remain deferred.
