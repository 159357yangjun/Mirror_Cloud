#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    ffi::OsString,
    io::Write,
    path::PathBuf,
    process::{Command, ExitCode, Stdio},
};

fn main() -> ExitCode {
    let args = env::args_os().skip(1).collect::<Vec<_>>();
    match args.first().and_then(|value| value.to_str()) {
        Some("--typora-upload") => return run_upload_mode(&args[1..], false),
        Some("--shell-upload") => return run_upload_mode(&args[1..], true),
        _ => {}
    }

    multicloud_publisher_desktop_lib::run();
    ExitCode::SUCCESS
}

fn run_upload_mode(args: &[OsString], copy_to_clipboard: bool) -> ExitCode {
    let mut data_dir: Option<PathBuf> = None;
    let mut paths = Vec::<PathBuf>::new();
    let mut index = 0usize;
    while index < args.len() {
        match args[index].to_str() {
            Some("--data-dir") => {
                index += 1;
                let Some(value) = args.get(index) else {
                    eprintln!("--data-dir requires a path");
                    return ExitCode::from(2);
                };
                data_dir = Some(PathBuf::from(value));
            }
            Some("--") => {
                paths.extend(args[index + 1..].iter().map(PathBuf::from));
                break;
            }
            _ => paths.push(PathBuf::from(&args[index])),
        }
        index += 1;
    }

    let Some(data_dir) = data_dir else {
        eprintln!(
            "Publisher integration is missing --data-dir. Reinstall the integration from Publisher > Settings."
        );
        return ExitCode::from(2);
    };
    if paths.is_empty() {
        eprintln!("No image paths were provided to Publisher.");
        return ExitCode::from(2);
    }

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("Cannot start Publisher runtime: {error}");
            return ExitCode::from(1);
        }
    };

    match runtime.block_on(
        multicloud_publisher_desktop_lib::cli::upload_with_default_workflow(&data_dir, &paths),
    ) {
        Ok(urls) => {
            if copy_to_clipboard {
                let text = urls.join("\r\n");
                if let Err(error) = write_windows_clipboard(&text) {
                    eprintln!("Upload succeeded, but copying the URL failed: {error}");
                    return ExitCode::from(1);
                }
            } else {
                for url in urls {
                    println!("{url}");
                }
            }
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}

fn write_windows_clipboard(text: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut child = Command::new("clip.exe")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|error| format!("cannot start clip.exe: {error}"))?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin
                .write_all(text.as_bytes())
                .map_err(|error| format!("cannot write clipboard text: {error}"))?;
        }
        let status = child
            .wait()
            .map_err(|error| format!("cannot wait for clip.exe: {error}"))?;
        if !status.success() {
            return Err(format!("clip.exe exited with {status}"));
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        Err("shell upload clipboard integration is currently Windows-only".into())
    }
}
