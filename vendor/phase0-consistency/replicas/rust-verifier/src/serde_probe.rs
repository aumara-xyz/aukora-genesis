//! Substrate probe: raw serde_json behaviour on file bytes.
//! DECODE_FAIL / FAIL / OK — no product admission rules.
use std::env;
use std::fs;
use std::process;

fn main() {
    let path = match env::args().nth(1) {
        Some(p) => p,
        None => {
            eprintln!("usage: serde-probe <file>");
            process::exit(2);
        }
    };
    let raw = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            println!("IO_FAIL {}", e);
            process::exit(1);
        }
    };
    let s = match String::from_utf8(raw) {
        Ok(s) => s,
        Err(e) => {
            println!("DECODE_FAIL {}", e);
            process::exit(1);
        }
    };
    match serde_json::from_str::<serde_json::Value>(&s) {
        Ok(v) => {
            println!("OK {}", v);
            process::exit(0);
        }
        Err(e) => {
            println!("FAIL {}", e);
            process::exit(1);
        }
    }
}
