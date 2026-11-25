// SUPPLEMENTARY protection (the primary guard is validate.js, before Firebase starts): after sign-in, the ID token's audience and issuer must
// name the project this build was validated for. A session issued by any other project is refused.
export function checkTokenAudience(claims, projectId) {
  if (!claims || typeof claims !== "object" || typeof projectId !== "string" || !projectId) return { ok: false, reason: "no-claims" }
  if (claims.aud !== projectId) return { ok: false, reason: "audience" }
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) return { ok: false, reason: "issuer" }
  return { ok: true }
}
