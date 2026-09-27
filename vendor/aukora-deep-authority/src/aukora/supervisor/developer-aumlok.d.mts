import type { BrokerAuthorityRequest } from '../broker/broker.mjs'
import type { SubjectAuthorityContext } from '../broker/subject-authority.mjs'
import type { RootControlDigest } from '../identity/control.mjs'
import type { AukoraId } from '../identity/genesis.mjs'
import type { LocalAumlokControl } from '../identity/local-control-store.mjs'

export interface DeveloperAumlokProjection {
  subject: AukoraId
  epoch: number
  activeControlDigest: RootControlDigest
  grantDomain: 'aukora:tool-grant:v5'
  custodyClass: 'same-uid-posix-mode-only'
}

export interface DeveloperAumlokAuthority {
  projection: Readonly<DeveloperAumlokProjection>
  subjectAuthorityExpectation: Readonly<{
    subject: AukoraId
    activeControlDigest: RootControlDigest
    audience: string
  }>
  selectSubjectAuthority(
    request: Readonly<BrokerAuthorityRequest>,
    signal: AbortSignal,
  ): Promise<Readonly<SubjectAuthorityContext>>
}

export declare const DEVELOPER_AUMLOK_PROJECTION_ENV: 'AUKORA_WEB_AUMLOK_CONTROL_PROJECTION_JSON'

export declare function projectDeveloperAumlok(
  control: Readonly<LocalAumlokControl>,
): Readonly<DeveloperAumlokProjection>

export declare function serializeDeveloperAumlokProjection(
  projection: unknown,
): string

export declare function createDeveloperAumlokAuthority(
  control: Readonly<LocalAumlokControl>,
  binding: Readonly<{ audience: string }>,
): Readonly<DeveloperAumlokAuthority>
