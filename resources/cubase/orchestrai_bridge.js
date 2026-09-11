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
  'track.set_volume',
  'track.set_mute',
  'track.set_solo',
  'plugin.set_bypass',
  'plugin.set_quick_control',
];
//! A bank is a window onto the project, not the project. Sixteen covers most
//! sessions a producer works with conversationally and keeps the SysEx payload
//! small; a larger session is reported as truncated rather than as though the
//! list were everything.
var BANK_SIZE = 16;
//! Cubase exposes eight quick controls per channel.
var QUICK_CONTROLS = 8;

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
        if (request.tool.indexOf('plugin.') === 0) {
          host.setPlugin(request.tool, request.arguments);
        }
        if (request.tool.indexOf('track.') === 0) {
          var field =
            request.tool === 'track.set_volume'
              ? 'volume'
              : request.tool === 'track.set_mute'
                ? 'mute'
                : 'solo';
          host.setTrack(request.arguments.trackId, field, request.arguments[field]);
        }
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
  var transport = page.mHostAccess.mTransport;

  // Host values cannot be written directly: MR_HostValue exposes only
  // increment/decrement. The supported path is a custom surface value bound to
  // the host value, which this script then drives from a bridge request.
  var startValue = deviceDriver.mSurface.makeCustomValueVariable('bridgeStart');
  var stopValue = deviceDriver.mSurface.makeCustomValueVariable('bridgeStop');
  page.makeValueBinding(startValue, transport.mValue.mStart);
  page.makeValueBinding(stopValue, transport.mValue.mStop);

  //! The mixer bank. Cubase fills these channels from the project; the script
  //! never assumes what is in them, it reports what the host says.
  var bank = page.mHostAccess.mMixConsole
    .makeMixerBankZone('OrchestrAI')
    .includeAudioChannels()
    .includeInstrumentChannels()
    .includeMIDIChannels()
    .includeGroupChannels()
    .includeFXChannels();
  var channels = [];
  for (var index = 0; index < BANK_SIZE; index++) {
    var channel = bank.makeMixerBankChannel();
    var volume = deviceDriver.mSurface.makeCustomValueVariable('trackVolume' + index);
    var mute = deviceDriver.mSurface.makeCustomValueVariable('trackMute' + index);
    var solo = deviceDriver.mSurface.makeCustomValueVariable('trackSolo' + index);
    page.makeValueBinding(volume, channel.mValue.mVolume);
    page.makeValueBinding(mute, channel.mValue.mMute);
    page.makeValueBinding(solo, channel.mValue.mSolo);
    //! Quick controls are what the producer already chose to expose on a
    //! control surface. Reaching arbitrary plugin parameters would need a
    //! parameter database this script cannot verify, and a wrong parameter
    //! moved in someone's session is worse than one that was never reachable.
    var quick = [];
    for (var q = 0; q < QUICK_CONTROLS; q++) {
      var qValue = deviceDriver.mSurface.makeCustomValueVariable('trackQuick' + index + '_' + q);
      page.makeValueBinding(qValue, channel.mQuickControls.getByIndex(q));
      quick.push({ index: q, name: '', value: 0, mapped: false, surface: qValue });
    }
    var bypass = deviceDriver.mSurface.makeCustomValueVariable('trackBypass' + index);
    page.makeValueBinding(bypass, channel.mInstrumentPluginSlot.mBypass);
    var entry = {
      id: 'track-' + index,
      name: '',
      type: 'audio',
      volume: 0,
      mute: false,
      solo: false,
      present: false,
      plugin: { name: '', bypassed: false, present: false },
      quick: quick,
      surface: { volume: volume, mute: mute, solo: solo, bypass: bypass },
    };
    channels.push(entry);
    //! Values come from the host's own callbacks. A script that trusted its own
    //! writes would drift the moment the producer moved a fader by hand.
    bindChannel(channel, entry);
  }
  function bindChannel(channel, entry) {
    channel.mInstrumentPluginSlot.mOnTitleChange = function (device, mapping, title) {
      entry.plugin.name = title || '';
      entry.plugin.present = !!title;
    };
    channel.mInstrumentPluginSlot.mBypass.mOnProcessValueChange = function (
      device,
      mapping,
      value,
    ) {
      entry.plugin.bypassed = value >= 0.5;
    };
    for (var q = 0; q < entry.quick.length; q++) bindQuickControl(channel, entry, q);
    channel.mOnTitleChange = function (activeDevice, activeMapping, title) {
      entry.name = title || '';
      entry.present = !!title;
      session.revision++;
    };
    channel.mValue.mVolume.mOnProcessValueChange = function (device, mapping, value) {
      entry.volume = value;
      entry.present = true;
    };
    channel.mValue.mMute.mOnProcessValueChange = function (device, mapping, value) {
      entry.mute = value >= 0.5;
    };
    channel.mValue.mSolo.mOnProcessValueChange = function (device, mapping, value) {
      entry.solo = value >= 0.5;
    };
  }

  // Project state is what Cubase last reported, never what this script assumed:
  // tempo and transport arrive through host callbacks.
  var session = { device: null, mapping: null, tempo: 120, playing: false, revision: 0 };
  transport.mTimeDisplay.mOnChangeTempoBPM = function (activeDevice, activeMapping, tempoBPM) {
    session.tempo = tempoBPM;
    session.revision++;
  };
  transport.mValue.mStart.mOnProcessValueChange = function (activeDevice, activeMapping, value) {
    session.playing = value >= 0.5;
    session.revision++;
  };
  page.mOnActivate = function (activeDevice, activeMapping) {
    session.device = activeDevice;
    session.mapping = activeMapping;
  };
  page.mOnDeactivate = function () {
    session.device = null;
    session.mapping = null;
  };

  function bindQuickControl(channel, entry, index) {
    var control = channel.mQuickControls.getByIndex(index);
    control.mOnTitleChange = function (device, mapping, objectTitle, valueTitle) {
      //! A control with no name is unmapped, not a nameless slot.
      var name = valueTitle || objectTitle || '';
      entry.quick[index].name = name;
      entry.quick[index].mapped = !!name;
    };
    control.mOnProcessValueChange = function (device, mapping, value) {
      entry.quick[index].value = value;
    };
  }
  function requireSession() {
    if (!session.device || !session.mapping)
      throw new Error('The OrchestrAI mapping page is not active in Cubase.');
  }
  var hostSurface = {
    daw: function () {
      return 'Cubase (MIDI Remote)';
    },
    readProject: function () {
      var tracks = [];
      for (var index = 0; index < channels.length; index++) {
        var entry = channels[index];
        if (!entry.present) continue;
        var controls = [];
        for (var c = 0; c < entry.quick.length; c++)
          if (entry.quick[c].mapped)
            controls.push({
              index: c,
              name: entry.quick[c].name,
              value: Math.max(0, Math.min(1, entry.quick[c].value)),
            });
        tracks.push({
          id: entry.id,
          name: entry.name || 'Channel ' + (index + 1),
          type: entry.type,
          mute: entry.mute,
          solo: entry.solo,
          volume: Math.max(0, Math.min(1, entry.volume)),
          plugin: entry.plugin.present
            ? { name: entry.plugin.name, bypassed: entry.plugin.bypassed, quickControls: controls }
            : null,
        });
      }
      return {
        name: 'Cubase session',
        tempo: session.tempo,
        key: 'Unknown',
        timeSignature: '4/4',
        playing: session.playing,
        revision: session.revision,
        mock: false,
        tracks: tracks,
        // Every channel reported means the project may hold more than the bank.
        tracksTruncated: tracks.length >= BANK_SIZE,
      };
    },
    setPlugin: function (tool, args) {
      requireSession();
      var entry = null;
      for (var index = 0; index < channels.length; index++)
        if (channels[index].id === args.trackId && channels[index].present) entry = channels[index];
      if (!entry) throw new Error('This session has no track "' + args.trackId + '".');
      if (!entry.plugin.present) throw new Error('"' + entry.name + '" has no plugin.');
      if (tool === 'plugin.set_bypass') {
        entry.surface.bypass.setProcessValue(session.device, args.bypassed ? 1 : 0);
        entry.plugin.bypassed = !!args.bypassed;
      } else {
        var control = entry.quick[args.index];
        if (!control || !control.mapped)
          throw new Error(
            'Quick control ' + args.index + ' is not mapped on "' + entry.name + '".',
          );
        control.surface.setProcessValue(session.device, args.value);
        control.value = args.value;
      }
      session.revision++;
    },
    setTrack: function (trackId, field, value) {
      requireSession();
      var entry = null;
      for (var index = 0; index < channels.length; index++)
        if (channels[index].id === trackId && channels[index].present) entry = channels[index];
      if (!entry) throw new Error('This session has no track "' + trackId + '".');
      var surfaceValue =
        field === 'volume'
          ? entry.surface.volume
          : field === 'mute'
            ? entry.surface.mute
            : entry.surface.solo;
      var numeric = field === 'volume' ? value : value ? 1 : 0;
      surfaceValue.setProcessValue(session.device, numeric);
      entry[field] = field === 'volume' ? numeric : numeric >= 0.5;
      session.revision++;
    },
    setTempo: function (tempo) {
      requireSession();
      transport.mTimeDisplay.setTempoBPM(session.mapping, tempo);
      session.tempo = tempo;
      session.revision++;
    },
    setPlaying: function (playing) {
      requireSession();
      // A bound trigger reads as a button press: raise it, then release it.
      var value = playing ? startValue : stopValue;
      value.setProcessValue(session.device, 1);
      value.setProcessValue(session.device, 0);
      session.playing = playing;
      session.revision++;
    },
  };
  var handle = createHandler(hostSurface);

  midiInput.mOnSysex = function (activeDevice, sysex) {
    var decoded = decodeFrame(sysex);
    if (!decoded.ok || decoded.frame.kind !== 'request') return;
    var response;
    try {
      response = handle(JSON.parse(decoded.frame.payload));
    } catch (error) {
      response = { ok: false, error: 'Malformed request payload.' };
    }
    midiOutput.sendMidi(
      activeDevice,
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
