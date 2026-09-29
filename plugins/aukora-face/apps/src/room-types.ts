/** index is the physical line's starting UTF-8 byte offset, including ACK/invalid line gaps. */
export interface RoomMessage {
  index: number
  id: string
  at: string
  from: string
  msg: string
}

export interface RoomPage {
  messages: RoomMessage[]
  /** Next unread byte, sent as ?after. null retries a tail with no complete boundary in its byte budget. */
  cursor: number | null
  reset: boolean
}
