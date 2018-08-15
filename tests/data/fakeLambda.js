'use strict';

/**
 * Example lambda function for tests
 *
 * @param {Object} event - lambda event object
 * @param {Object} context - lambda context object
 * @param {Object} cb - the callback function
 * @returns {Undefined} undefined
 */
function handler(event, context, cb) {
  if (event.error) {
    return cb(event.error);
  }

  return cb(null, event);
}

module.exports = {
  handler
};