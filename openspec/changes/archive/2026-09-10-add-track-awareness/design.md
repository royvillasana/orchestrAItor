## Context

The MIDI Remote API reaches the mixer through a bank zone: a script declares which channel kinds it wants, makes a fixed number of bank channels, and Cubase fills them from the project. Each channel carries host values for volume, pan, mute, and solo, and reports its name through a title callback. Host values cannot be written directly — the same constraint the transport work already ran into — so each is bound to a custom surface value the script can drive.

## Decisions

### Volume is the fader position, not decibels

Cubase reports a normalized fader value. Converting it to decibels means reproducing Steinberg's fader taper, which this project would be guessing at, and a wrong decibel figure is worse than an honest normalized one because it looks authoritative. So `ProjectState` track volume becomes a 0-to-1 fader position, the mock fixture is changed to match, and the interface shows a percentage. A producer who wants decibels reads them in Cubase, where they are correct.

This is a contract change rather than an addition, and both adapters change together so they cannot disagree.

### A bank is a window, not the project

A bank zone holds a fixed number of channels. Sixteen covers most sessions a producer would work with conversationally and keeps the SysEx payload small. A session with more channels reports the first bank and says so, rather than implying the list is everything.

### State comes from callbacks

Names and values are recorded when Cubase reports them, never from what the script last wrote. A script that trusts its own writes drifts the moment the producer moves a fader by hand, and this is the same rule the tempo and transport work already follows.

### Track writes address a track by id

`track.set_volume`, `track.set_mute`, and `track.set_solo` take a track id and a value. The id is the channel's position in the bank, which is stable while the session is open. A write naming a track that is not in the reported state is refused before anything is sent, so a stale conversation cannot reach the wrong channel.

### Undo works as it already does

A track write mutates the session, so it snapshots state and is undoable through the existing revision check — nothing new is introduced. Restoring means restoring the whole reported state, which is what the existing undo already does.

## Risks / Trade-offs

Bank contents follow Cubase's own ordering and visibility rules. A producer who hides channels sees a different bank, and the reported list is what the remote sees rather than a definitive project inventory.

Sixteen channels is a judgement, not a limit of the API. Raising it costs payload size on every state read; the number is stated rather than hidden.

## Migration Plan

Additive except for the volume definition, which changes meaning in `ProjectState`. The mock fixture is updated in the same change, and the interface presents volume as a percentage so no reader sees an unlabelled number that used to be decibels.
