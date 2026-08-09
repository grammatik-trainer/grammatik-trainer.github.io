const localFallbackOrigin = "http://localhost:3000";

interface SiteOriginEnvironment {
  [key: string]: string | undefined;
  SITE_ORIGIN?: string;
  SITE_ALLOWED_ORIGINS?: string;
}

function parseOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    const valid = (parsed.protocol === "https:" || parsed.protocol === "http:")
      && !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash;
    return valid ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function configuredSiteOrigins(environment: SiteOriginEnvironment = process.env) {
  const configuredPrimary = parseOrigin(environment.SITE_ORIGIN);
  const primary = configuredPrimary ?? localFallbackOrigin;
  const additional = (environment.SITE_ALLOWED_ORIGINS ?? "").split(",").map((value) => parseOrigin(value)).filter((value): value is string => value !== null);
  return { primary, allowed: new Set([primary, ...additional]), useRequestOrigin: !environment.SITE_ORIGIN?.trim() };
}

/**
 * The origin to build absolute metadata URLs from.
 *
 * Read from `SITE_ORIGIN` at module load rather than from request headers: a
 * static export has no request, and touching `headers()` marks the render
 * dynamic, which makes the exporter skip the page entirely.
 */
export function siteOrigin(environment: SiteOriginEnvironment = process.env) {
  return configuredSiteOrigins(environment).primary;
}

export function resolveMetadataOrigin(host: string | null, protocol: string | null, environment: SiteOriginEnvironment = process.env) {
  const configured = configuredSiteOrigins(environment);
  const forwardedHost = host?.split(",")[0]?.trim();
  const forwardedProtocol = protocol?.split(",")[0]?.trim();
  if (!forwardedHost || !/^[a-z0-9.:[\]-]+$/i.test(forwardedHost) || (forwardedProtocol !== "https" && forwardedProtocol !== "http")) return configured.primary;
  try {
    const candidate = new URL(`${forwardedProtocol}://${forwardedHost}`).origin;
    return configured.useRequestOrigin || configured.allowed.has(candidate) ? candidate : configured.primary;
  } catch {
    return configured.primary;
  }
}
