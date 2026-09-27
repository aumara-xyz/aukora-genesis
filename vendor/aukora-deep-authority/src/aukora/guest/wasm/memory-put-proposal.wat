(module
  (import "aukora" "propose_memory_put"
    (func $propose_memory_put (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1 1)
  (func (export "memory_put")
    (param $key_offset i32)
    (param $key_length i32)
    (param $value_offset i32)
    (param $value_length i32)
    (result i32)
    local.get $key_offset
    local.get $key_length
    local.get $value_offset
    local.get $value_length
    call $propose_memory_put))
