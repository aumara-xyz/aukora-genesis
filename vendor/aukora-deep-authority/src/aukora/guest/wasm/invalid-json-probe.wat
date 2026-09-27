(module
  (import "aukora" "propose_memory_put"
    (func $propose_memory_put (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1 1)
  (data (i32.const 1024) "x")
  (func (export "memory_put")
    (param $key_offset i32)
    (param $key_length i32)
    (param $value_offset i32)
    (param $value_length i32)
    (result i32)
    local.get $key_offset
    local.get $key_length
    i32.const 1024
    i32.const 1
    call $propose_memory_put))
