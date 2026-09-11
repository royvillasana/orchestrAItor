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
  'track.set_pan',
  'track.set_record_enable',
  'track.set_monitor',
  'track.select',
  'channel.set_eq_band',
  'channel.set_send',
  'channel.set_insert',
  'channel.set_automation',
  'mixer.page',
  'host.run_command',
];
//! Cubase commands this script will run, and no others. A command takes no
//! arguments and acts on whatever is selected, so the allowlist is the safety
//! boundary. Ids match the host's contract; `dialog` marks the ones that open a
//! window this API cannot answer, reported as opened rather than as done.
var COMMANDS = [
  { id: 'save', category: 'File', name: 'Save', dialog: false },
  { id: 'undo', category: 'Edit', name: 'Undo', dialog: false },
  { id: 'redo', category: 'Edit', name: 'Redo', dialog: false },
  { id: 'record', category: 'Transport', name: 'Record', dialog: false },
  { id: 'duplicate_tracks', category: 'Project', name: 'Duplicate Tracks', dialog: false },
  { id: 'remove_tracks', category: 'Project', name: 'Remove Selected Tracks', dialog: false },
  {
    id: 'add_group_track',
    category: 'Project',
    name: 'Add Track To Selected: Group Channel',
    dialog: false,
  },
  {
    id: 'add_fx_track',
    category: 'Project',
    name: 'Add Track To Selected: FX Channel',
    dialog: false,
  },
  { id: 'rename_track', category: 'Project', name: 'Rename First Selected Track', dialog: true },
  { id: 'export_mixdown', category: 'File', name: 'Export Audio Mixdown', dialog: true },
  { id: 'import_midi', category: 'File', name: 'Import MIDI File', dialog: true },
];
//! Four bands is what the channel EQ has; sends and inserts are asked of the
//! host rather than assumed, since they differ by channel type.
var EQ_BANDS = 4;
//! Eight insert slots, for the same reason the bank is sixteen channels: it
//! covers the working case and keeps the SysEx payload small.
var INSERT_SLOTS = 8;
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
      //! A whole session is a large SysEx message, and MIDI is a slow wire. The
      //! revision is four bytes, so a caller can poll cheaply and ask for the
      //! state only when something actually changed.
      if (request.op === 'get_revision') return { ok: true, result: { revision: host.revision() } };
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
        if (request.tool === 'mixer.page') host.pageBank(request.arguments.direction);
        if (request.tool === 'host.run_command')
          return {
            ok: true,
            result: {
              project: host.readProject(),
              command: host.runCommand(request.arguments.command),
            },
          };
        if (request.tool.indexOf('channel.') === 0)
          host.setSelectedChannel(request.tool, request.arguments);
        if (request.tool.indexOf('track.') === 0) {
          var fields = {
            'track.set_volume': 'volume',
            'track.set_mute': 'mute',
            'track.set_solo': 'solo',
            'track.set_pan': 'pan',
            'track.set_record_enable': 'armed',
            'track.set_monitor': 'monitoring',
            'track.select': 'selected',
          };
          var field = fields[request.tool];
          //! Selecting takes no value of its own: asking for it is the value.
          var value = request.tool === 'track.select' ? true : request.arguments[field];
          host.setTrack(request.arguments.trackId, field, value);
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
    var pan = deviceDriver.mSurface.makeCustomValueVariable('trackPan' + index);
    var armed = deviceDriver.mSurface.makeCustomValueVariable('trackArm' + index);
    var monitoring = deviceDriver.mSurface.makeCustomValueVariable('trackMonitor' + index);
    var selected = deviceDriver.mSurface.makeCustomValueVariable('trackSelect' + index);
    page.makeValueBinding(volume, channel.mValue.mVolume);
    page.makeValueBinding(mute, channel.mValue.mMute);
    page.makeValueBinding(solo, channel.mValue.mSolo);
    page.makeValueBinding(pan, channel.mValue.mPan);
    page.makeValueBinding(armed, channel.mValue.mRecordEnable);
    page.makeValueBinding(monitoring, channel.mValue.mMonitorEnable);
    page.makeValueBinding(selected, channel.mValue.mSelected);
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
      pan: 0.5,
      armed: false,
      monitoring: false,
      selected: false,
      present: false,
      plugin: { name: '', bypassed: false, present: false },
      quick: quick,
      surface: {
        volume: volume,
        mute: mute,
        solo: solo,
        bypass: bypass,
        pan: pan,
        armed: armed,
        monitoring: monitoring,
        selected: selected,
      },
    };
    channels.push(entry);
    //! Values come from the host's own callbacks. A script that trusted its own
    //! writes would drift the moment the producer moved a fader by hand.
    bindChannel(channel, entry);
  }
  //! The selected track, which is where the API puts a channel's depth: EQ,
  //! sends and inserts belong to one channel at a time, not to the bank.
  var selectedChannel = page.mHostAccess.mTrackSelection.mMixerChannel;
  var selection = {
    name: '',
    present: false,
    automation: { read: false, write: false },
    eq: [],
    sends: [],
    inserts: [],
    surface: { read: null, write: null },
  };
  selectedChannel.mOnTitleChange = function (device, mapping, title) {
    selection.name = title || '';
    selection.present = !!title;
    session.revision++;
  };
  var readValue = deviceDriver.mSurface.makeCustomValueVariable('selAutoRead');
  var writeValue = deviceDriver.mSurface.makeCustomValueVariable('selAutoWrite');
  page.makeValueBinding(readValue, selectedChannel.mValue.mAutomationRead);
  page.makeValueBinding(writeValue, selectedChannel.mValue.mAutomationWrite);
  selection.surface.read = readValue;
  selection.surface.write = writeValue;
  selectedChannel.mValue.mAutomationRead.mOnProcessValueChange = function (d, m, value) {
    selection.automation.read = value >= 0.5;
  };
  selectedChannel.mValue.mAutomationWrite.mOnProcessValueChange = function (d, m, value) {
    selection.automation.write = value >= 0.5;
  };
  for (var band = 0; band < EQ_BANDS; band++) bindEqBand(band);
  function bindEqBand(index) {
    //! Bands are numbered from one in Cubase's own interface, so they are
    //! numbered from one here too rather than making a producer translate.
    var host = selectedChannel.mChannelEQ['mBand' + (index + 1)];
    var entry = { band: index + 1, on: false, gain: 0.5, frequency: 0.5, q: 0.5, surface: {} };
    var fields = [
      ['on', host.mOn],
      ['gain', host.mGain],
      ['frequency', host.mFreq],
      ['q', host.mQ],
    ];
    for (var f = 0; f < fields.length; f++) bindEqValue(entry, fields[f][0], fields[f][1], index);
    selection.eq.push(entry);
  }
  function bindEqValue(entry, field, hostValue, index) {
    var surface = deviceDriver.mSurface.makeCustomValueVariable('selEq' + index + field);
    page.makeValueBinding(surface, hostValue);
    entry.surface[field] = surface;
    hostValue.mOnProcessValueChange = function (device, mapping, value) {
      entry[field] = field === 'on' ? value >= 0.5 : value;
    };
  }
  //! How many send and insert slots exist is the host's answer, not ours: it
  //! differs by channel type, and guessing would mean reporting slots that are
  //! not there.
  var sendCount = Math.min(16, selectedChannel.mSends.getNumberOfSendSlots());
  for (var sendIndex = 0; sendIndex < sendCount; sendIndex++) bindSend(sendIndex);
  function bindSend(index) {
    var slot = selectedChannel.mSends.getByIndex(index);
    var entry = { slot: index, on: false, level: 0, preFader: false, surface: {} };
    var fields = [
      ['on', slot.mOn],
      ['level', slot.mLevel],
      ['preFader', slot.mPrePost],
    ];
    for (var f = 0; f < fields.length; f++) {
      var surface = deviceDriver.mSurface.makeCustomValueVariable('selSend' + index + fields[f][0]);
      page.makeValueBinding(surface, fields[f][1]);
      entry.surface[fields[f][0]] = surface;
      bindSendValue(entry, fields[f][0], fields[f][1]);
    }
    selection.sends.push(entry);
  }
  function bindSendValue(entry, field, hostValue) {
    hostValue.mOnProcessValueChange = function (device, mapping, value) {
      entry[field] = field === 'level' ? value : value >= 0.5;
    };
  }
  //! Insert slots are read through one viewer per slot index, which is the
  //! access the API gives: a viewer reports what is loaded and can switch it on
  //! or bypass it. Loading or replacing a plugin is not reachable from here.
  for (var insertIndex = 0; insertIndex < INSERT_SLOTS; insertIndex++) bindInsert(insertIndex);
  function bindInsert(index) {
    var viewer = selectedChannel.mInsertAndStripEffects.makeInsertEffectViewer(
      'OrchestrAI Insert ' + index,
    );
    viewer.accessSlotAtIndex(index);
    var entry = { slot: index, name: '', on: false, bypassed: false, present: false, surface: {} };
    var on = deviceDriver.mSurface.makeCustomValueVariable('selInsertOn' + index);
    var bypass = deviceDriver.mSurface.makeCustomValueVariable('selInsertBypass' + index);
    page.makeValueBinding(on, viewer.mOn);
    page.makeValueBinding(bypass, viewer.mBypass);
    entry.surface.on = on;
    entry.surface.bypassed = bypass;
    viewer.mOnTitleChange = function (device, mapping, title) {
      entry.name = title || '';
      entry.present = !!title;
    };
    viewer.mOn.mOnProcessValueChange = function (device, mapping, value) {
      entry.on = value >= 0.5;
    };
    viewer.mBypass.mOnProcessValueChange = function (device, mapping, value) {
      entry.bypassed = value >= 0.5;
    };
    selection.inserts.push(entry);
  }
  //! Bank paging. A control surface reads a window; moving it is how a session
  //! larger than the window stays reachable.
  var bankActions = {
    next: bank.mAction.mNextBank,
    previous: bank.mAction.mPrevBank,
    right: bank.mAction.mShiftRight,
    left: bank.mAction.mShiftLeft,
    reset: bank.mAction.mResetBank,
  };
  //! Commands are bound once, ahead of any request: the API binds a surface
  //! value to a command name, and triggering that value is how the command runs.
  var commandValues = {};
  for (var command = 0; command < COMMANDS.length; command++) bindCommand(COMMANDS[command]);
  function bindCommand(entry) {
    var surface = deviceDriver.mSurface.makeCustomValueVariable('cmd_' + entry.id);
    page.makeCommandBinding(surface, entry.category, entry.name);
    commandValues[entry.id] = surface;
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
    channel.mValue.mPan.mOnProcessValueChange = function (device, mapping, value) {
      entry.pan = value;
    };
    channel.mValue.mRecordEnable.mOnProcessValueChange = function (device, mapping, value) {
      entry.armed = value >= 0.5;
    };
    channel.mValue.mMonitorEnable.mOnProcessValueChange = function (device, mapping, value) {
      entry.monitoring = value >= 0.5;
    };
    channel.mValue.mSelected.mOnProcessValueChange = function (device, mapping, value) {
      entry.selected = value >= 0.5;
      session.revision++;
    };
  }

  // Project state is what Cubase last reported, never what this script assumed:
  // tempo and transport arrive through host callbacks.
  var session = {
    device: null,
    mapping: null,
    tempo: 120,
    playing: false,
    revision: 0,
    bankOffset: 0,
  };
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
  function writeFields(entry, args, fields) {
    for (var index = 0; index < fields.length; index++) {
      var field = fields[index];
      if (args[field] === undefined) continue;
      var numeric =
        field === 'gain' || field === 'frequency' || field === 'q' || field === 'level'
          ? args[field]
          : args[field]
            ? 1
            : 0;
      entry.surface[field].setProcessValue(session.device, numeric);
      entry[field] = typeof args[field] === 'boolean' ? !!args[field] : numeric;
    }
  }
  function readSelection() {
    var eq = [];
    for (var b = 0; b < selection.eq.length; b++)
      eq.push({
        band: selection.eq[b].band,
        on: selection.eq[b].on,
        gain: clamp(selection.eq[b].gain),
        frequency: clamp(selection.eq[b].frequency),
        q: clamp(selection.eq[b].q),
      });
    var sends = [];
    for (var s = 0; s < selection.sends.length; s++)
      sends.push({
        slot: selection.sends[s].slot,
        on: selection.sends[s].on,
        level: clamp(selection.sends[s].level),
        preFader: selection.sends[s].preFader,
      });
    var inserts = [];
    for (var i = 0; i < selection.inserts.length; i++)
      //! An empty slot is not reported as a nameless insert.
      if (selection.inserts[i].present)
        inserts.push({
          slot: selection.inserts[i].slot,
          name: selection.inserts[i].name,
          on: selection.inserts[i].on,
          bypassed: selection.inserts[i].bypassed,
        });
    var selectedId = '';
    for (var c = 0; c < channels.length; c++)
      if (channels[c].present && channels[c].selected) selectedId = channels[c].id;
    return {
      trackId: selectedId || 'selected',
      name: selection.name,
      automation: { read: selection.automation.read, write: selection.automation.write },
      eq: eq,
      sends: sends,
      inserts: inserts,
    };
  }
  function clamp(value) {
    return Math.max(0, Math.min(1, value));
  }
  function requireSession() {
    if (!session.device || !session.mapping)
      throw new Error('The OrchestrAI mapping page is not active in Cubase.');
  }
  var hostSurface = {
    daw: function () {
      return 'Cubase (MIDI Remote)';
    },
    revision: function () {
      return session.revision;
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
          pan: Math.max(0, Math.min(1, entry.pan)),
          recordEnabled: entry.armed,
          monitoring: entry.monitoring,
          selected: entry.selected,
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
        // The window this surface is reading, so a session larger than the bank
        // is described rather than silently cut off at its edge.
        bank: { offset: session.bankOffset, size: BANK_SIZE, total: null },
        selectedChannel: selection.present ? readSelection() : null,
      };
    },
    pageBank: function (direction) {
      requireSession();
      var action = bankActions[direction];
      if (!action) throw new Error('Unknown bank direction "' + direction + '".');
      action.trigger(session.mapping);
      // The host reports the channels it moved to through the usual callbacks;
      // the offset is this script's own count of how far it has asked to move.
      if (direction === 'next') session.bankOffset += BANK_SIZE;
      if (direction === 'previous')
        session.bankOffset = Math.max(0, session.bankOffset - BANK_SIZE);
      if (direction === 'right') session.bankOffset += 1;
      if (direction === 'left') session.bankOffset = Math.max(0, session.bankOffset - 1);
      if (direction === 'reset') session.bankOffset = 0;
      session.revision++;
    },
    runCommand: function (id) {
      requireSession();
      var entry = null;
      for (var index = 0; index < COMMANDS.length; index++)
        if (COMMANDS[index].id === id) entry = COMMANDS[index];
      if (!entry) throw new Error('Command "' + id + '" is not one this bridge will run.');
      var value = commandValues[entry.id];
      // A bound command reads as a button press: raise it, then release it.
      value.setProcessValue(session.device, 1);
      value.setProcessValue(session.device, 0);
      session.revision++;
      return { id: entry.id, name: entry.name, dialog: entry.dialog };
    },
    setSelectedChannel: function (tool, args) {
      requireSession();
      if (!selection.present) throw new Error('No track is selected in Cubase.');
      if (tool === 'channel.set_automation') {
        if (args.read !== undefined) {
          selection.surface.read.setProcessValue(session.device, args.read ? 1 : 0);
          selection.automation.read = !!args.read;
        }
        if (args.write !== undefined) {
          selection.surface.write.setProcessValue(session.device, args.write ? 1 : 0);
          selection.automation.write = !!args.write;
        }
      }
      if (tool === 'channel.set_eq_band') {
        var band = null;
        for (var b = 0; b < selection.eq.length; b++)
          if (selection.eq[b].band === args.band) band = selection.eq[b];
        if (!band) throw new Error('This channel has no EQ band ' + args.band + '.');
        writeFields(band, args, ['on', 'gain', 'frequency', 'q']);
      }
      if (tool === 'channel.set_send') {
        var send = null;
        for (var sl = 0; sl < selection.sends.length; sl++)
          if (selection.sends[sl].slot === args.slot) send = selection.sends[sl];
        if (!send) throw new Error('This channel has no send slot ' + args.slot + '.');
        writeFields(send, args, ['on', 'level', 'preFader']);
      }
      if (tool === 'channel.set_insert') {
        var insert = null;
        for (var i = 0; i < selection.inserts.length; i++)
          if (selection.inserts[i].slot === args.slot) insert = selection.inserts[i];
        if (!insert) throw new Error('This channel has no insert slot ' + args.slot + '.');
        if (!insert.present) throw new Error('Insert slot ' + args.slot + ' is empty.');
        writeFields(insert, args, ['on', 'bypassed']);
      }
      session.revision++;
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
      if (!entry)
        throw new Error(
          'This bank is not showing a track "' + trackId + '". Page the mixer to reach it.',
        );
      var surfaceValue = entry.surface[field];
      if (!surfaceValue) throw new Error('Unknown channel field "' + field + '".');
      //! Continuous fields carry their value; the rest are switches.
      var continuous = field === 'volume' || field === 'pan';
      var numeric = continuous ? value : value ? 1 : 0;
      surfaceValue.setProcessValue(session.device, numeric);
      entry[field] = continuous ? numeric : numeric >= 0.5;
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
