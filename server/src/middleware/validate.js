/**
 * Express middleware that validates req.body, req.query, and req.params with Zod schemas.
 * Stores validated copies on req.validated (and updates req.body) to stay safe across Express versions.
 */
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    try {
      const validatedBody = body ? body.parse(req.body) : req.body;
      const validatedQuery = query ? query.parse(req.query) : req.query;
      const validatedParams = params ? params.parse(req.params) : req.params;

      if (body) {
        req.body = validatedBody;
      }
      req.validatedQuery = validatedQuery;
      req.validatedParams = validatedParams;
      req.validated = {
        body: validatedBody,
        query: validatedQuery,
        params: validatedParams,
      };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
