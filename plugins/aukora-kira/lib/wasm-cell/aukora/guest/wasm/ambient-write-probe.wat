(module
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (func (export "try_write") (result i32)
    i32.const 1
    i32.const 0
    i32.const 0
    i32.const 0
    call $fd_write))
