(module
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "aukora" "propose_memory_put"
    (func $propose_memory_put (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1 1)
  (func (export "memory_put")
    (param $key_offset i32)
    (param $key_length i32)
    (param $value_offset i32)
    (param $value_length i32)
    (result i32)
    i32.const 1
    i32.const 0
    i32.const 0
    i32.const 0
    call $fd_write
    drop
    local.get $key_offset
    local.get $key_length
    local.get $value_offset
    local.get $value_length
    call $propose_memory_put))
