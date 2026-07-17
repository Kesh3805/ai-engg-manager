/**
 * Typed HTTP errors thrown by the auth guards (and any server-layer code).
 * Route handlers catch them via `errorResponse()` so status semantics stay
 * consistent everywhere:
 *
 *   401 — no session
 *   403 — same-org but insufficient role (resource existence already known)
 *   404 — cross-org resource: identical to "not found" so org membership is
 *         never an enumeration oracle
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'authentication required') {
    super(401, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'insufficient role') {
    super(403, message);
  }
}

/** Cross-org access and genuinely missing resources both surface as this. */
export class ResourceNotFoundError extends HttpError {
  constructor(message = 'not found') {
    super(404, message);
  }
}

/**
 * Map an unknown thrown value to a Response. HttpErrors keep their status;
 * anything else is a 500 with no internal detail leaked.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error('[api] unhandled error:', err);
  return Response.json({ error: 'internal error' }, { status: 500 });
}
