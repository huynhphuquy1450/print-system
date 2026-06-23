'use strict';

/**
 * HttpError — thrown by services/routes to signal an HTTP error response.
 * Caught by middleware/error.js → formatted as JSON `{ error: <message> }`.
 */
class HttpError extends Error {
 constructor(status, message) {
 super(message);
 this.status = status;
 }
}

module.exports = { HttpError };