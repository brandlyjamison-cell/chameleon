/** An error that carries an HTTP status, so routes never guess. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export const unauthorized = () => new HttpError(401, "unauthenticated");
export const forbidden = (code = "forbidden") => new HttpError(403, code);
export const notFound = () => new HttpError(404, "not_found");
export const conflict = (code: string) => new HttpError(409, code);
export const invalid = (code = "invalid_input") => new HttpError(422, code);
