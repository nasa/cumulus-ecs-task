'use strict';

/**
 * Example lambda function for tests
 *
 * @param {Object} event - lambda event object
 * @param {Object} _context - lambda context object (unused)
 * @returns {Undefined} undefined
 */
async function handler(event, _context) {
  if (event.error) {
    throw event.error;
  }
  return event;
}

module.exports = {
  handler
};
