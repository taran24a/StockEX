import type { RequestHandler } from "express";
import xss from "xss";

const xssOptions: XSS.IFilterXSSOptions = {
  whiteList: {},
  stripIgnoreTag: true,
  stripIgnoreTagBody: ["script", "style"]
};

function sanitizeValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    return /^(?:password|password_hash|token)$/i.test(key) ? value : xss(value, xssOptions);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)])
    );
  }
  return value;
}

export const sanitizeRequest: RequestHandler = (request, _response, next) => {
  request.body = sanitizeValue(request.body) as typeof request.body;
  request.params = sanitizeValue(request.params) as typeof request.params;
  Object.defineProperty(request, "query", {
    configurable: true,
    enumerable: true,
    value: sanitizeValue(request.query)
  });
  next();
};
