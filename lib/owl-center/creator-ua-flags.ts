/** Client/server-safe feature flag for Core creator UA handoff. */
export function isOwlCenterCreatorUaHandoffEnabled(): boolean {
  return process.env.OWL_CENTER_CREATOR_UA_HANDOFF !== 'false'
}
