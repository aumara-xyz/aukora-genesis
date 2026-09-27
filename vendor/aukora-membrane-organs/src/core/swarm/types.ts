/** Swarm control-plane types. Proposal-only by default. No authority grant. */

export type ClaimKind = "built" | "spec" | "research" | "blocked" | "docs"

export type Role =
  | "conductor"
  | "scout"
  | "speccer"
  | "implementer"
  | "adversary"
  | "auditor"
  | "zipper"

export type CampaignState =
  | "draft"
  | "running"
  | "conserve"
  | "halt_new_work"
  | "complete"
  | "cancelled"

export type BriefState =
  | "open"
  | "leased"
  | "proposed"
  | "refused"
  | "merged"
  | "abandoned"

export interface PathLease {
  id: string
  globs: string[]
  holderBriefId: string
  expiresAt: string
}

export interface Budget {
  maxWorkers: number
  maxProposals: number
  maxWallClockMin: number
  maxTokens?: number
  haltOnVerifyRed: boolean
}

export interface Campaign {
  id: string
  title: string
  createdAt: string
  state: CampaignState
  issueNumbers: number[]
  budget: Budget
  notes?: string
}

export interface IssueNode {
  number: number
  title: string
  state: string
  labels: string[]
  blockedBy: number[]
  unlocks: number[]
  lane: "boundary" | "docs" | "research" | "product" | "governance" | "identity"
  mutation: "none" | "docs" | "spec" | "core" | "owner"
}

export interface Brief {
  id: string
  campaignId: string
  role: Role
  issueNumber: number
  slice: string
  state: BriefState
  allowedGlobs: string[]
  forbiddenGlobs: string[]
  doneWhen: string[]
  parentHead?: string
  claimKind: ClaimKind
  createdAt: string
}

export interface ProposalMeta {
  id: string
  briefId: string
  issueNumber: number
  claimKind: ClaimKind
  summary: string
  patchPath?: string
  verifyLogPath?: string
  createdAt: string
}
