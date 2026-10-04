use bytes::Bytes;
use chrono::{Datelike, Utc};
use domain::{PublishTarget, Workflow, WorkflowStep};
use image_processing::{ImageTransformSpec, OutputImageFormat, process_image};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum WorkflowError {
    #[error("workflow has no publish target")]
    MissingPublishTarget,
    #[error("workflow rename template cannot be empty")]
    EmptyRenameTemplate,
    #[error("workflow generated an invalid remote path")]
    InvalidRemotePath,
    #[error("image processing failed: {0}")]
    Processing(String),
}

#[derive(Debug, Clone)]
pub struct PreparedAsset {
    pub body: Bytes,
    pub mime_type: String,
    pub extension: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub content_hash: String,
    pub remote_path: String,
    pub variant_label: String,
    pub target: PublishTarget,
    pub output_template: Option<String>,
    pub transformed: bool,
}

pub fn prepare_asset(
    workflow: &Workflow,
    input: &[u8],
    input_name: &str,
    input_mime: &str,
) -> Result<PreparedAsset, WorkflowError> {
    let mut max_width = None;
    let mut max_height = None;
    let mut format = OutputImageFormat::Original;
    let mut quality = 88u8;
    let mut rename_template = "uploads/{year}/{month}/{hash:12}-u{uuid}-{stem}.{ext}".to_string();
    let mut target = None;
    let mut output_template = None;

    for step in &workflow.steps {
        match step {
            WorkflowStep::Resize {
                max_width: width,
                max_height: height,
            } => {
                max_width = Some(*width);
                max_height = Some(*height);
            }
            WorkflowStep::Convert {
                format: target_format,
                quality: target_quality,
            } => {
                format = OutputImageFormat::from_key(target_format)
                    .map_err(|error| WorkflowError::Processing(error.to_string()))?;
                quality = *target_quality;
            }
            WorkflowStep::Rename { template } => rename_template = template.clone(),
            WorkflowStep::Publish {
                target: publish_target,
            } => target = Some(publish_target.clone()),
            WorkflowStep::Output { template } => output_template = Some(template.clone()),
        }
    }

    if rename_template.trim().is_empty() {
        return Err(WorkflowError::EmptyRenameTemplate);
    }
    let target = target.ok_or(WorkflowError::MissingPublishTarget)?;
    let input_extension = input_name
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .unwrap_or("bin");
    let processed = process_image(
        input,
        input_mime,
        input_extension,
        &ImageTransformSpec {
            max_width,
            max_height,
            format,
            quality,
        },
    )
    .map_err(|error| WorkflowError::Processing(error.to_string()))?;

    let content_hash = hex::encode(Sha256::digest(processed.body.as_ref()));
    let remote_path = render_remote_path(
        &rename_template,
        input_name,
        &processed.extension,
        &content_hash,
    )?;
    let variant_label = if processed.transformed {
        format!("workflow:{}", workflow.name)
    } else {
        "original".into()
    };

    Ok(PreparedAsset {
        body: processed.body,
        mime_type: processed.mime_type,
        extension: processed.extension,
        width: processed.width,
        height: processed.height,
        content_hash,
        remote_path,
        variant_label,
        target,
        output_template,
        transformed: processed.transformed,
    })
}

pub fn render_remote_path(
    template: &str,
    input_name: &str,
    extension: &str,
    hash: &str,
) -> Result<String, WorkflowError> {
    let now = Utc::now();
    let stem = input_name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(input_name);
    let mut rendered = template
        .replace("{name}", &sanitize_segment(input_name))
        .replace("{stem}", &sanitize_segment(stem))
        .replace("{ext}", &sanitize_segment(extension))
        .replace("{year}", &format!("{:04}", now.year()))
        .replace("{month}", &format!("{:02}", now.month()))
        .replace("{day}", &format!("{:02}", now.day()))
        .replace("{uuid}", &Uuid::new_v4().simple().to_string());

    for length in [8usize, 12, 16, 24, 32] {
        let token = format!("{{hash:{length}}}");
        if rendered.contains(&token) {
            rendered = rendered.replace(&token, &hash[..hash.len().min(length)]);
        }
    }
    rendered = rendered.replace("{hash}", hash);

    let segments = rendered
        .replace('\\', "/")
        .split('/')
        .filter(|segment| !segment.trim().is_empty())
        .map(sanitize_segment)
        .collect::<Vec<_>>();
    if segments.is_empty() || segments.iter().any(|segment| segment == "..") {
        return Err(WorkflowError::InvalidRemotePath);
    }
    Ok(segments.join("/"))
}

fn sanitize_segment(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('.')
        .trim()
        .to_string();
    if sanitized.is_empty() {
        "asset".into()
    } else {
        sanitized
    }
}
