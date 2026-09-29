/** The cursor is the zero-based physical line index, including ACKs and invalid lines. */
export interface RoomMessage {
  index: number
  id: string
  at: string
  from: string
  msg: string
}

export interface RoomPage {
  messages: RoomMessage[]
  cursor: number
  reset: boolean
}
