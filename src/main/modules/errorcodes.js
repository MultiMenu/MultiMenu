'use strict';
// Roblox disconnect / error codes in plain English, plus what the 24/7 Watcher
// should do about each one:
//   rejoin  - try the same server first, then the game (normal back-off)
//   newServer - don't go back to that server; join the game fresh
//   slow    - rejoin, but wait longer (e.g. after a kick, or an update)
//   stop    - rejoining won't help or would cause harm; stop and tell you
const CODES = {
  17: { title: 'Connection attempt failed', meaning: 'The client could not reach the game server (network, firewall or the server was full/closing).', action: 'newServer' },
  260: { title: 'Problem receiving data', meaning: 'The client stopped receiving data from the server.', action: 'rejoin' },
  264: { title: 'Logged in somewhere else', meaning: 'The same account joined a game from another device or another client.', action: 'stop', hint: 'Make sure this account isn\'t running in two places (another PC, phone or a second client).' },
  266: { title: 'Connection timed out', meaning: 'The server stopped responding for too long — usually your internet or the server.', action: 'rejoin' },
  267: { title: 'Kicked by the game', meaning: 'The game\'s own scripts removed you (anti-AFK, anti-cheat, server rules or a moderator).', action: 'slow', hint: 'Repeated 267s often mean the game doesn\'t allow AFK or automation. Check its rules.' },
  268: { title: 'Kicked for unexpected client behaviour', meaning: 'Roblox\'s server rejected the client\'s behaviour.', action: 'stop', hint: 'Close any third-party tools that modify the Roblox client.' },
  271: { title: 'Disconnected by the server', meaning: 'The server ended the connection (often a server restart).', action: 'newServer' },
  272: { title: 'Disconnected due to a security issue', meaning: 'Roblox ended the session for a security/integrity reason.', action: 'stop' },
  273: { title: 'Disconnected — account used elsewhere', meaning: 'The same account was used in another session.', action: 'stop', hint: 'This account is probably open on another device.' },
  274: { title: 'Server shut down by the developer', meaning: 'The game\'s developer closed this server.', action: 'newServer' },
  275: { title: 'Server shut down for an update', meaning: 'Roblox or the game is updating; servers are restarting.', action: 'slow' },
  277: { title: 'Lost connection to the game server', meaning: 'The most common disconnect: a network hiccup or a server problem.', action: 'rejoin' },
  278: { title: 'Kicked for being idle (20 minutes)', meaning: 'Roblox disconnects players who do nothing for 20 minutes.', action: 'rejoin', hint: 'Anti-AFK (nudge mode) can prevent this where the game allows it.' },
  279: { title: 'Failed to connect to the game', meaning: 'The client couldn\'t join (ID=17, firewall, or the server was full).', action: 'newServer' },
  280: { title: 'Roblox version out of date', meaning: 'The client needs an update before it can join.', action: 'slow', hint: 'If you hold Roblox updates, press Update Roblox now (Sessions & Tiling → Roblox updates). Otherwise open Roblox normally once so it updates, then MultiMenu can rejoin.' },
  282: { title: 'Disconnected — unknown reason', meaning: 'The server closed the connection without a specific reason.', action: 'rejoin' },
  285: { title: 'Left the game', meaning: 'The client chose to leave (closed in-game or teleport ended).', action: 'rejoin' },
  286: { title: 'Device lost connection', meaning: 'Your PC\'s network connection dropped.', action: 'slow' },
  517: { title: 'Game unavailable', meaning: 'This game or place is currently unavailable or closed.', action: 'slow' },
  522: { title: 'Followed player left', meaning: 'The user you were joining has left the game.', action: 'newServer' },
  523: { title: 'Game status changed', meaning: 'The game\'s access changed (made private, shut down, or restricted).', action: 'stop' },
  524: { title: 'Not allowed to join', meaning: 'This account isn\'t authorised for that server (private server, not invited, or age/region restrictions).', action: 'stop' },
  529: { title: 'Roblox service error', meaning: 'Roblox\'s own services are having problems.', action: 'slow', hint: 'Check status.roblox.com.' },
  533: { title: 'Privacy settings prevent joining', meaning: 'The player\'s privacy settings don\'t allow you to join them.', action: 'stop' },
  610: { title: 'Could not join the game instance', meaning: 'The specific server could not be joined (it may be full or gone).', action: 'newServer' },
  769: { title: 'Teleport failed', meaning: 'A teleport between places failed.', action: 'rejoin' },
  770: { title: 'Teleport failed — place unavailable', meaning: 'The destination place could not be started.', action: 'newServer' },
  771: { title: 'Teleport failed — server full or closing', meaning: 'The destination server couldn\'t take you.', action: 'newServer' },
  772: { title: 'Teleport failed', meaning: 'The teleport to another place did not complete.', action: 'rejoin' },
  773: { title: 'Teleport blocked', meaning: 'The destination place is restricted.', action: 'stop' },
};

const ACTION_TEXT = { rejoin: 'Rejoining', newServer: 'Joining a different server', slow: 'Rejoining after a longer wait', stop: 'Not rejoining' };

function lookup(code) {
  const c = Number(code);
  if (!c) return null;
  const e = CODES[c];
  return e ? { code: c, ...e, actionText: ACTION_TEXT[e.action] } : { code: c, title: `Error ${c}`, meaning: 'An unlisted Roblox error.', action: 'rejoin', actionText: ACTION_TEXT.rejoin };
}

/** "Error 277 - Lost connection to the game server" */
function describe(code) { const e = lookup(code); return e ? `Error ${e.code} — ${e.title}` : null; }

function all() { return Object.entries(CODES).map(([code, e]) => ({ code: Number(code), ...e, actionText: ACTION_TEXT[e.action] })); }

module.exports = { lookup, describe, all, CODES, ACTION_TEXT };
