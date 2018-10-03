/* eslint no-console: "off" */

'use strict';

/**
 * A class for writing JSON-formated logs to STDOUT
 */
class Logger {
  /**
   * @param {Object} [options] - options object
   * @param {string} [options.sender='cumulus-ecs-task'] - options.sender - an optional sender for
   *   the log messages
   */
  constructor(options = {}) {
    this._sender = options.sender || 'cumulus-ecs-task';
  }

  /**
   * Setter for the sender property
   *
   * @param {string} value - the sender for the log messages
   */
  set sender(value) {
    this._sender = value;
  }

  /**
   * Log an info message
   *
   * @param {string} message - the message to log
   * @returns {undefined} no return value
   */
  info(message) {
    this.writeMessage('info', message);
  }

  /**
   * Log an error message
   *
   * @param {string} message - the message to log
   * @param {Error} err - the error to log
   * @returns {undefined} no return value
   */
  error(message, err) {
    let msg;
    if (err.stack) {
      msg = `${message} ${err.stack.replace(/\n/g, ' ')}`;
    }
    else {
      msg = err;
    }
    this.writeMessage('error', msg);
  }

  /**
   * Log a message to stdout
   *
   * @param {string} level - the level of the message
   * @param {string} message - the message to log
   * @returns {undefined} no return value
   * @memberof Logger
   */
  writeMessage(level, message) {
    const output = {
      level,
      message,
      sender: this._sender,
      timestamp: (new Date()).toISOString()
    };

    console.log(JSON.stringify(output));
  }
}
module.exports = Logger;
