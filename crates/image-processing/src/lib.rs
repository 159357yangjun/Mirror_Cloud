use std::io::Cursor;

use bytes::Bytes;
use image::{
    DynamicImage, GenericImageView, ImageFormat, codecs::jpeg::JpegEncoder, imageops::FilterType,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ImageProcessingError {
    #[error("unsupported image format for this operation: {0}")]
    UnsupportedFormat(String),
    #[error("cannot decode image: {0}")]
    Decode(String),
    #[error("cannot encode image: {0}")]
    Encode(String),
    #[error("quality must be between 1 and 100")]
    InvalidQuality,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OutputImageFormat {
    Original,
    Jpeg,
    Png,
    Webp,
}

impl OutputImageFormat {
    pub fn from_key(value: &str) -> Result<Self, ImageProcessingError> {
        match value {
            "original" => Ok(Self::Original),
            "jpeg" | "jpg" => Ok(Self::Jpeg),
            "png" => Ok(Self::Png),
            "webp" => Ok(Self::Webp),
            other => Err(ImageProcessingError::UnsupportedFormat(other.into())),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageTransformSpec {
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    pub format: OutputImageFormat,
    pub quality: u8,
}

#[derive(Debug, Clone)]
pub struct ProcessedImage {
    pub body: Bytes,
    pub mime_type: String,
    pub extension: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub transformed: bool,
}

pub fn process_image(
    input: &[u8],
    input_mime: &str,
    input_extension: &str,
    spec: &ImageTransformSpec,
) -> Result<ProcessedImage, ImageProcessingError> {
    if !(1..=100).contains(&spec.quality) {
        return Err(ImageProcessingError::InvalidQuality);
    }

    let resize_requested = spec.max_width.is_some() || spec.max_height.is_some();
    if spec.format == OutputImageFormat::Original && !resize_requested {
        return Ok(ProcessedImage {
            body: Bytes::copy_from_slice(input),
            mime_type: input_mime.to_string(),
            extension: normalize_extension(input_extension),
            width: None,
            height: None,
            transformed: false,
        });
    }

    let mut image = image::load_from_memory(input)
        .map_err(|error| ImageProcessingError::Decode(error.to_string()))?;

    if resize_requested {
        image = resize_to_fit(image, spec.max_width, spec.max_height);
    }

    let (width, height) = image.dimensions();
    let target = if spec.format == OutputImageFormat::Original {
        original_target(input_mime)?
    } else {
        spec.format.clone()
    };
    let (body, mime_type, extension) = encode_image(&image, target, spec.quality)?;

    Ok(ProcessedImage {
        body: Bytes::from(body),
        mime_type,
        extension,
        width: Some(width),
        height: Some(height),
        transformed: true,
    })
}

fn resize_to_fit(
    image: DynamicImage,
    max_width: Option<u32>,
    max_height: Option<u32>,
) -> DynamicImage {
    let (width, height) = image.dimensions();
    let max_width = max_width.unwrap_or(width).max(1);
    let max_height = max_height.unwrap_or(height).max(1);
    if width <= max_width && height <= max_height {
        return image;
    }
    image.resize(max_width, max_height, FilterType::Lanczos3)
}

fn original_target(input_mime: &str) -> Result<OutputImageFormat, ImageProcessingError> {
    match input_mime {
        "image/jpeg" => Ok(OutputImageFormat::Jpeg),
        "image/png" => Ok(OutputImageFormat::Png),
        "image/webp" => Ok(OutputImageFormat::Webp),
        other => Err(ImageProcessingError::UnsupportedFormat(format!(
            "{other}; resize with original format currently supports JPEG, PNG and WebP"
        ))),
    }
}

fn encode_image(
    image: &DynamicImage,
    format: OutputImageFormat,
    quality: u8,
) -> Result<(Vec<u8>, String, String), ImageProcessingError> {
    match format {
        OutputImageFormat::Jpeg => {
            let rgb = image.to_rgb8();
            let mut output = Vec::new();
            JpegEncoder::new_with_quality(&mut output, quality)
                .encode_image(&DynamicImage::ImageRgb8(rgb))
                .map_err(|error| ImageProcessingError::Encode(error.to_string()))?;
            Ok((output, "image/jpeg".into(), "jpg".into()))
        }
        OutputImageFormat::Png => {
            let mut output = Cursor::new(Vec::new());
            image
                .write_to(&mut output, ImageFormat::Png)
                .map_err(|error| ImageProcessingError::Encode(error.to_string()))?;
            Ok((output.into_inner(), "image/png".into(), "png".into()))
        }
        OutputImageFormat::Webp => {
            let rgba = image.to_rgba8();
            let (width, height) = image.dimensions();
            let encoder = webp::Encoder::from_rgba(rgba.as_raw(), width, height);
            let encoded = encoder.encode(quality as f32);
            Ok((encoded.to_vec(), "image/webp".into(), "webp".into()))
        }
        OutputImageFormat::Original => unreachable!("original is normalized before encoding"),
    }
}

pub fn encode_rgba_png(
    rgba: &[u8],
    width: u32,
    height: u32,
) -> Result<Vec<u8>, ImageProcessingError> {
    if width == 0 || height == 0 {
        return Err(ImageProcessingError::Encode(
            "clipboard image has invalid dimensions".into(),
        ));
    }
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(ImageProcessingError::Encode(format!(
            "clipboard RGBA length mismatch: expected {expected}, got {}",
            rgba.len()
        )));
    }
    let image = image::RgbaImage::from_raw(width, height, rgba.to_vec()).ok_or_else(|| {
        ImageProcessingError::Encode("cannot build clipboard image buffer".into())
    })?;
    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| ImageProcessingError::Encode(error.to_string()))?;
    Ok(output.into_inner())
}

fn normalize_extension(extension: &str) -> String {
    let lowered = extension.trim_start_matches('.').to_ascii_lowercase();
    match lowered.as_str() {
        "jpeg" => "jpg".into(),
        "" => "bin".into(),
        _ => lowered,
    }
}
