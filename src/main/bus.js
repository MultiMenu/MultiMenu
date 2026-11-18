'use strict';
// App-wide event bus. Modules emit events here; the notification centre,
// Discord webhooks and the renderer all listen.
const { EventEmitter } = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(50);
module.exports = bus;
