export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}
