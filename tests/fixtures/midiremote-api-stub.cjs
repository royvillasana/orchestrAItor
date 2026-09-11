/**
 * Stand-in for Cubase's `midiremote_api_v1`, shaped after the API definition
 * shipped inside Cubase 15 (midiremote_factory_scripts/.api/v1). It records
 * what the driver script calls so the script's Cubase glue can be exercised
 * outside Cubase, where only the protocol half was verifiable before.
 */
function SurfaceValue(name, log) {
  this.name = name;
  this.setProcessValue = function (device, value) {
    log.push({ call: 'setProcessValue', name: name, device: device, value: value });
  };
  this.getProcessValue = function () {
    return 0;
  };
}
function makeApi() {
  const log = [];
  const driver = {
    mPorts: {
      makeMidiInput: (name) => (driver._input = { name, mOnSysex: null }),
      makeMidiOutput: (name) =>
        (driver._output = {
          name,
          sendMidi: (device, message) => log.push({ call: 'sendMidi', device, message }),
        }),
    },
    mSurface: {
      makeCustomValueVariable: (name) => new SurfaceValue(name, log),
    },
    makeDetectionUnit: () => ({
      detectPortPair: () => ({
        expectInputNameEquals: () => ({ expectOutputNameEquals: () => ({}) }),
      }),
    }),
    mMapping: {
      makePage: (name) => {
        const transport = {
          mValue: {
            mStart: { mOnProcessValueChange: null },
            mStop: { mOnProcessValueChange: null },
          },
          mTimeDisplay: {
            mOnChangeTempoBPM: null,
            setTempoBPM: (mapping, bpm) => log.push({ call: 'setTempoBPM', mapping, bpm }),
          },
        };
        const makeHostValue = () => ({ mOnProcessValueChange: null });
        const channels = [];
        const bankZone = {
          makeMixerBankChannel: () => {
            const quickControls = Array.from({ length: 8 }, () => ({
              mOnTitleChange: null,
              mOnProcessValueChange: null,
            }));
            const channel = {
              mValue: { mVolume: makeHostValue(), mMute: makeHostValue(), mSolo: makeHostValue() },
              mQuickControls: { getByIndex: (index) => quickControls[index] },
              mInstrumentPluginSlot: {
                mOn: makeHostValue(),
                mBypass: makeHostValue(),
                mOnTitleChange: null,
              },
              _quickControls: quickControls,
              mOnTitleChange: null,
            };
            channels.push(channel);
            return channel;
          },
        };
        for (const include of [
          'includeAudioChannels',
          'includeInstrumentChannels',
          'includeMIDIChannels',
          'includeGroupChannels',
          'includeFXChannels',
        ])
          bankZone[include] = () => bankZone;
        driver._channels = channels;
        return (driver._page = {
          name,
          mHostAccess: {
            mTransport: transport,
            mMixConsole: { makeMixerBankZone: () => bankZone },
          },
          makeValueBinding: (surfaceValue, hostValue) =>
            log.push({ call: 'makeValueBinding', surfaceValue: surfaceValue.name, hostValue }),
          mOnActivate: null,
          mOnDeactivate: null,
        });
      },
    },
  };
  return {
    log,
    driver,
    makeDeviceDriver: (vendor, device, author) => {
      log.push({ call: 'makeDeviceDriver', vendor, device, author });
      return driver;
    },
  };
}
module.exports = { makeApi };
