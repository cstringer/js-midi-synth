const messages = document.getElementById('messages');
const startBtn = document.getElementById('start');
const status = document.getElementById('status');

let audioContext;
let masterGainNode;
let masterFilter;

const midiPorts = {};
const pressedKeys = {};


document.addEventListener('DOMContentLoaded', onDomContentLoaded);


function onDomContentLoaded() {
  if (!navigator.requestMIDIAccess) {
    logStatus('No MIDI support available.');
    disableStartBtn();
    return;
  }

  setupMidi();

  startBtn.addEventListener('click', onStartBtnClick);
}

function onStartBtnClick() {
  createAudio();
  disableStartBtn({ btnText: 'Synth Running' });
}

/*===== MIDI =====*/

async function setupMidi() {
  logStatus('Setting up MIDI...');
  try {
    const access = await navigator.requestMIDIAccess();
    access.addEventListener('statechange', onStateChange);
    access.inputs.forEach(enableMidiInput);
  } catch(e) {
    logStatus('Error setting up MIDI: ' + e.message);
  }
}

function enableMidiInput(input) {
  if (midiPorts[input.name]) { return; }

  logStatus(`Found MIDI input: '${input.name}'`);
  input.addEventListener('statechange', onStateChange);
  input.addEventListener('midimessage', onMidiMessage);

  midiPorts[input.name] = input;
}

function disableMidiInput(input) {
  if (!midiPorts[input.name]) { return; }

  logStatus(`Disabling MIDI input: '${input.name}'`);
  input.removeEventListener('statechange', onStateChange);
  input.removeEventListener('midimessage', onMidiMessage);

  delete midiPorts[input.name];
}

function onStateChange({ port }) {
  logStatus(`State change: ${port.name}, ${port.state}`);

  if (port.type === 'input') {
    switch (port.state) {
      case 'connected':
        enableMidiInput(port);
        break;

      case 'disconnected':
        disableMidiInput(port);
        break;
    }
  }
}

function onMidiMessage(message) {
  printMessageInfo(message);

  const { data } = message;
  const [statusByte, data1, data2] = data;

  if (isNoteOn(statusByte)) {
    playNote(data1, data2);
  }

  if (isNoteOff(statusByte)) {
    stopNote(data1);
  }

  if (statusByte === 176) {
    switch(data1) {
      // modulation
      case 1:
        break;

      // volume
      case 7:
        setMasterGain(data2 / 127);
        break;
    }
  }

  // pitch bend
  if (statusByte === 224) {
    setMasterFilterFreq(data2);
  }
}

function isNoteOn(statusByte) {
  return (statusByte >= 144 && statusByte <= 159);
}

function isNoteOff(statusByte) {
  return (statusByte >= 128 && statusByte <= 143);
}

// https://en.wikipedia.org/wiki/MIDI_tuning_standard#Frequency_values
function midiNoteToFreq(note) {
  return Math.pow(2, (note - 69) / 12) * 440;
}

function midiVelocityToGain(velocity) {
  return Math.log(Math.pow(10, velocity)) / 292.4283068102438;
}


/*===== WebAudio =====*/

function createAudio() {
  logStatus('Starting AudioContext...');

  const ACtx = window.AudioContext || window.webkitAudioContext;
  if (!ACtx) {
    logStatus('No constructor for AudioContext found.');
    return;
  }

  audioContext = new ACtx();

  masterGainNode = audioContext.createGain();
  masterGainNode.gain.value = 0.5;

  masterFilter = createFilter();

  masterGainNode.connect(masterFilter);
  masterFilter.connect(audioContext.destination);
}

function createFilter() {
  const filter = audioContext.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency = 1000;
  filter.Q = 8;
  return filter;
}

function playNote(note, velocity) {
  if (!audioContext) { return; }

  const freq = midiNoteToFreq(note);
  const osc = createOscillator(freq);

  const gainVal = midiVelocityToGain(velocity);
  const gainNode = createGain(gainVal);
  osc.connect(gainNode);

  pressedKeys[note] = osc;
  osc.start();
}

function stopNote(note) {
  let osc = pressedKeys[note];
  if (!osc) { return; }

  osc.stop();
  delete pressedKeys[note];
  osc = null;
}

function createOscillator(frequency) {
  const osc = audioContext.createOscillator();
  osc.type = 'square';
  osc.frequency.value = frequency;
  return osc;
}

function createGain(value) {
  const gainNode = audioContext.createGain();
  gainNode.connect(masterGainNode);
  gainNode.gain.value = value;
  return gainNode;
}

function setMasterGain(value) {
  if (masterGainNode) {
    masterGainNode.gain.value = value;
  }
}

function setMasterFilterFreq(data) {
  if (masterFilter) {
    masterFilter.frequency.value = (data / 64) * 1000;
  }
}

/*===== UI and such =====*/

function printMessageInfo({ data, target }) {
  let noteFreq = '';
  if (isNoteOn(data[0]) || isNoteOff(data[0])) {
    noteFreq = `(${midiNoteToFreq(data[1])})`;
  }

  messages.innerText = `
=====================
${target.name}
---------------------
Status: ${data[0]}
Data 1: ${data[1]} ${noteFreq}
Data 2: ${data[2]}
=====================
  `;
}

function logStatus(message) {
  /*eslint-disable no-console*/
  console.log(message);
  /*eslint-enable no-console*/
  status.innerText += `${message}\n`;
}

function disableStartBtn({ btnText }) {
  startBtn.setAttribute('disabled', 'disabled');
  if (btnText) {
    startBtn.innerText = btnText;
  }
}
