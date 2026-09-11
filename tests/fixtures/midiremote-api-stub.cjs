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
              mValue: {
                mVolume: makeHostValue(),
                mMute: makeHostValue(),
                mSolo: makeHostValue(),
                mPan: makeHostValue(),
                mRecordEnable: makeHostValue(),
                mMonitorEnable: makeHostValue(),
                mSelected: makeHostValue(),
              },
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
        // The bank's own paging actions, recorded so a test can see which one
        // the script triggered.
        const action = (name) => ({
          trigger: (mapping) => log.push({ call: 'bank', name, mapping }),
        });
        bankZone.mAction = {
          mNextBank: action('next'),
          mPrevBank: action('previous'),
          mShiftLeft: action('left'),
          mShiftRight: action('right'),
          mResetBank: action('reset'),
        };
        // The selected track, where the API puts EQ, sends and inserts.
        const eqBand = () => ({
          mOn: makeHostValue(),
          mGain: makeHostValue(),
          mFreq: makeHostValue(),
          mQ: makeHostValue(),
        });
        const sendSlots = Array.from({ length: 4 }, () => ({
          mOn: makeHostValue(),
          mLevel: makeHostValue(),
          mPrePost: makeHostValue(),
        }));
        const inserts = [];
        const selectedChannel = {
          mOnTitleChange: null,
          mValue: { mAutomationRead: makeHostValue(), mAutomationWrite: makeHostValue() },
          mChannelEQ: { mBand1: eqBand(), mBand2: eqBand(), mBand3: eqBand(), mBand4: eqBand() },
          mSends: {
            getNumberOfSendSlots: () => sendSlots.length,
            getByIndex: (index) => sendSlots[index],
          },
          mInsertAndStripEffects: {
            makeInsertEffectViewer: (name) => {
              const viewer = {
                name,
                mOn: makeHostValue(),
                mBypass: makeHostValue(),
                mOnTitleChange: null,
                accessSlotAtIndex: (index) => {
                  viewer.slot = index;
                  return viewer;
                },
              };
              inserts.push(viewer);
              return viewer;
            },
          },
        };
        driver._selected = selectedChannel;
        driver._inserts = inserts;
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
            mTrackSelection: { mMixerChannel: selectedChannel },
          },
          makeValueBinding: (surfaceValue, hostValue) =>
            log.push({ call: 'makeValueBinding', surfaceValue: surfaceValue.name, hostValue }),
          makeCommandBinding: (surfaceValue, commandCategory, commandName) =>
            log.push({
              call: 'makeCommandBinding',
              surfaceValue: surfaceValue.name,
              commandCategory,
              commandName,
            }),
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
