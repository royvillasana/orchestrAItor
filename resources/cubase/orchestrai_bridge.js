//! OrchestrAI bridge — Cubase MIDI Remote driver script.
//!
//! Install: copy this file to
//!   macOS   ~/Documents/Steinberg/Cubase/MIDI Remote/Driver Scripts/Local/OrchestrAI/OrchestrAI_Bridge/
//!   Windows %USERPROFILE%\Documents\Steinberg\Cubase\MIDI Remote\Driver Scripts\Local\OrchestrAI\OrchestrAI_Bridge\
//! then pair it with the OrchestrAI virtual MIDI port pair in Cubase's MIDI Remote Manager.
//! Targets Cubase 12 and newer, which is where the MIDI Remote API is available.
//!
//! The protocol half of this file is pure and is exported for tests, so the
//! shipped artifact itself is verified against the host implementation rather
//! than a copy that could drift from it.

var PROTOCOL_VERSION = 1;
var SYSEX_START = 0xf0;
var SYSEX_END = 0xf7;
var MANUFACTURER_ID = 0x7d;
var MAX_PAYLOAD_BYTES = 4096;
var KINDS = ['request', 'response'];
var OPERATIONS = [
  'project.get_state',
  'project.get_tempo',
  'project.set_tempo',
  'transport.play',
  'transport.stop',
];

function utf8Encode(text) {
  var bytes = [];
  for (var index = 0; index < text.length; index++) {
    var code = text.charCodeAt(index);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      var pair = 0x10000 + ((code - 0xd800) << 10) + (text.charCodeAt(++index) - 0xdc00);
      bytes.push(
        0xf0 | (pair >> 18),
        0x80 | ((pair >> 12) & 0x3f),
        0x80 | ((pair >> 6) & 0x3f),
        0x80 | (pair & 0x3f),
      );
    } else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}
function utf8Decode(bytes) {
  var text = '';
  for (var index = 0; index < bytes.length; ) {
    var byte = bytes[index++];
    var code;
    if (byte < 0x80) code = byte;
    else if (byte >= 0xc0 && byte < 0xe0) code = ((byte & 0x1f) << 6) | (bytes[index++] & 0x3f);
    else if (byte >= 0xe0 && byte < 0xf0)
      code = ((byte & 0x0f) << 12) | ((bytes[index++] & 0x3f) << 6) | (bytes[index++] & 0x3f);
    else {
      code =
        ((byte & 0x07) << 18) |
        ((bytes[index++] & 0x3f) << 12) |
        ((bytes[index++] & 0x3f) << 6) |
        (bytes[index++] & 0x3f);
      code -= 0x10000;
      text += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
      continue;
    }
    text += String.fromCharCode(code);
  }
  return text;
}
function to7Bit(bytes) {
  var out = [];
  for (var index = 0; index < bytes.length; index += 7) {
    var chunk = bytes.slice(index, index + 7);
    var high = 0;
    for (var position = 0; position < chunk.length; position++)
      high |= ((chunk[position] >> 7) & 1) << position;
    out.push(high);
    for (var byte = 0; byte < chunk.length; byte++) out.push(chunk[byte] & 0x7f);
  }
  return out;
}
function from7Bit(bytes) {
  var out = [];
  for (var index = 0; index < bytes.length; ) {
    var high = bytes[index++];
    if (high > 0x7f) return null;
    var remaining = Math.min(7, bytes.length - index);
    if (remaining <= 0) break;
    for (var position = 0; position < remaining; position++) {
      var byte = bytes[index++];
      if (byte > 0x7f) return null;
      out.push(byte | (((high >> position) & 1) << 7));
    }
  }
  return out;
}
function checksum(bytes) {
  var sum = 0;
  for (var index = 0; index < bytes.length; index++) sum = (sum + bytes[index]) & 0x7f;
  return sum;
}
function encodeFrame(frame) {
  var payload = to7Bit(utf8Encode(frame.payload));
  if (payload.length > MAX_PAYLOAD_BYTES)
    throw new Error('The bridge payload exceeds the ceiling.');
  var body = [
    frame.protocol === undefined ? PROTOCOL_VERSION : frame.protocol,
    KINDS.indexOf(frame.kind),
    frame.correlation & 0x7f,
    (payload.length >> 7) & 0x7f,
    payload.length & 0x7f,
  ].concat(payload);
  return [SYSEX_START, MANUFACTURER_ID].concat(body, [checksum(body), SYSEX_END]);
}
function decodeFrame(bytes) {
  if (bytes.length < 9 || bytes[0] !== SYSEX_START || bytes[bytes.length - 1] !== SYSEX_END)
    return { ok: false, reason: 'not-sysex' };
  if (bytes[1] !== MANUFACTURER_ID) return { ok: false, reason: 'foreign-manufacturer' };
  var body = bytes.slice(2, bytes.length - 2);
  if (body.length < 5) return { ok: false, reason: 'truncated' };
  if (checksum(body) !== bytes[bytes.length - 2]) return { ok: false, reason: 'bad-checksum' };
  var kind = KINDS[body[1]];
  if (!kind) return { ok: false, reason: 'unknown-kind' };
  var length = (body[3] << 7) | body[4];
  var payload = body.slice(5);
  if (payload.length !== length) return { ok: false, reason: 'bad-length' };
  var decoded = from7Bit(payload);
  if (!decoded) return { ok: false, reason: 'bad-payload' };
  return {
    ok: true,
    frame: { protocol: body[0], kind: kind, correlation: body[2], payload: utf8Decode(decoded) },
  };
}

//! Session glue. `host` is the small surface the Cubase page supplies, so the
//! request handling below stays testable without the Cubase script host.
function createHandler(host) {
  return function handle(request) {
    try {
      if (request.op === 'hello')
        return {
          ok: true,
          result: { protocol: PROTOCOL_VERSION, daw: host.daw(), operations: OPERATIONS },
        };
      if (request.op === 'get_state') return { ok: true, result: { project: host.readProject() } };
      if (request.op === 'execute') {
        if (OPERATIONS.indexOf(request.tool) === -1)
          return { ok: false, error: 'Unsupported operation ' + request.tool + '.' };
        if (request.tool === 'project.set_tempo') host.setTempo(request.arguments.tempo);
        if (request.tool === 'transport.play') host.setPlaying(true);
        if (request.tool === 'transport.stop') host.setPlaying(false);
        return { ok: true, result: { project: host.readProject() } };
      }
      return { ok: false, error: 'Unknown operation.' };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  };
}

var api = null;
try {
  // Only Cubase's script host provides this module; requiring it under Node
  // fails, which is how this file stays loadable by the parity tests.
  api = require('midiremote_api_v1');
} catch (error) {
  api = null;
}
if (api) {
  var deviceDriver = api.makeDeviceDriver('OrchestrAI', 'Bridge', 'OrchestrAI');
  var midiInput = deviceDriver.mPorts.makeMidiInput('OrchestrAI Bridge In');
  var midiOutput = deviceDriver.mPorts.makeMidiOutput('OrchestrAI Bridge Out');
  deviceDriver
    .makeDetectionUnit()
    .detectPortPair(midiInput, midiOutput)
    .expectInputNameEquals('OrchestrAI Bridge')
    .expectOutputNameEquals('OrchestrAI Bridge');
  var page = deviceDriver.mMapping.makePage('OrchestrAI');
  var state = { tempo: 120, playing: false, revision: 0, name: 'Cubase session', context: null };
  var hostSurface = {
    daw: function () {
      return 'Cubase (MIDI Remote)';
    },
    readProject: function () {
      return {
        name: state.name,
        tempo: state.tempo,
        key: 'Unknown',
        timeSignature: '4/4',
        playing: state.playing,
        revision: state.revision,
        mock: false,
        tracks: [],
      };
    },
    setTempo: function (tempo) {
      if (state.context) page.setParameterValue(state.context, 'tempo', tempo);
      state.tempo = tempo;
      state.revision++;
    },
    setPlaying: function (playing) {
      if (state.context)
        page.mHostAccess.mTransport.mValue[playing ? 'mStart' : 'mStop'].setProcessValue(
          state.context,
          1,
        );
      state.playing = playing;
      state.revision++;
    },
  };
  var handle = createHandler(hostSurface);
  page.mOnActivate = function (context) {
    state.context = context;
  };
  midiInput.mOnSysex = function (context, sysex) {
    var decoded = decodeFrame(sysex);
    if (!decoded.ok || decoded.frame.kind !== 'request') return;
    var response;
    try {
      response = handle(JSON.parse(decoded.frame.payload));
    } catch (error) {
      response = { ok: false, error: 'Malformed request payload.' };
    }
    midiOutput.sendMidi(
      context,
      encodeFrame({
        kind: 'response',
        correlation: decoded.frame.correlation,
        payload: JSON.stringify(response),
      }),
    );
  };
}

if (typeof module !== 'undefined' && module.exports)
  module.exports = {
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    OPERATIONS: OPERATIONS,
    encodeFrame: encodeFrame,
    decodeFrame: decodeFrame,
    createHandler: createHandler,
    to7Bit: to7Bit,
    from7Bit: from7Bit,
  };
